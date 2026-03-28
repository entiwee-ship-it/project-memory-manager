#!/usr/bin/env python3
"""
project-memory-manager 技能校验器。

模式：
- auto：优先严格校验；缺少 PyYAML 时自动补环境；最后才回退便携校验
- strict：要求 PyYAML
- portable：仅用内置纯 Python 便携校验
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import uuid
import venv
from pathlib import Path


SAFE_TEMP_SITECUSTOMIZE = """\
import os
import tempfile


def _safe_mkdtemp(suffix=None, prefix=None, dir=None):
    suffix = suffix or ""
    prefix = prefix or "tmp"
    if dir is None:
        dir = tempfile.gettempdir()

    attempts = 0
    while attempts < tempfile.TMP_MAX:
        candidate = os.path.join(dir, f"{prefix}{next(tempfile._get_candidate_names())}{suffix}")
        try:
            os.mkdir(candidate)
            return candidate
        except FileExistsError:
            attempts += 1

    raise FileExistsError("No usable temporary directory name found")


tempfile.mkdtemp = _safe_mkdtemp
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验技能包，并在缺少依赖时优先尝试自动补环境。")
    parser.add_argument(
        "skill_path",
        nargs="?",
        default="",
        help="技能目录路径；不传时自动按常见位置查找。",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "strict", "portable"],
        default="auto",
        help="校验模式",
    )
    parser.add_argument(
        "--venv-path",
        default="",
        help="可选的 PyYAML 安装 venv 目录",
    )
    return parser.parse_args()


def candidate_skill_paths() -> list[Path]:
    candidates = []
    env_path = os.environ.get("PMM_SKILL_SOURCE", "").strip()
    if env_path:
        candidates.append(Path(env_path))

    cwd = Path.cwd()
    script_root = Path(__file__).resolve().parent.parent
    candidates.extend(
        [
            cwd,
            script_root,
            Path.home() / ".codex" / "skills" / "project-memory-manager",
        ]
    )

    deduped = []
    seen = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if str(resolved) in seen:
            continue
        seen.add(str(resolved))
        deduped.append(resolved)
    return deduped


def resolve_skill_path(cli_value: str) -> Path:
    if cli_value:
        return Path(cli_value).resolve()

    for candidate in candidate_skill_paths():
        if candidate.exists() and (candidate / "SKILL.md").exists():
            return candidate

    return candidate_skill_paths()[0]


def project_root(skill_path: Path) -> Path:
    current = skill_path.resolve()
    for candidate in [current.parent, *current.parents]:
        if (candidate / "project-memory").exists():
            return candidate
    return skill_path


def runtime_root(skill_path: Path) -> Path:
    root = project_root(skill_path)
    if root == skill_path:
        return skill_path / ".runtime"
    return root / "project-memory" / "reports"


def requirements_file(skill_path: Path, root: Path) -> Path:
    local_requirements = skill_path / "scripts" / "requirements-validation.txt"
    if local_requirements.exists():
        return local_requirements
    return root / "project-memory" / "scripts" / "requirements-validation.txt"


def local_venv_path(skill_path: Path, root: Path, cli_path: str) -> Path:
    if cli_path:
        return Path(cli_path).resolve()
    return runtime_root(skill_path) / "validation-tools-venv"


def local_temp_root(skill_path: Path, root: Path) -> Path:
    return runtime_root(skill_path) / "validation-temp"


def create_session_dir(base_dir: Path, prefix: str) -> Path:
    base_dir.mkdir(parents=True, exist_ok=True)
    for _ in range(16):
        candidate = base_dir / f"{prefix}-{uuid.uuid4().hex}"
        try:
            candidate.mkdir(parents=True, exist_ok=False)
            return candidate
        except FileExistsError:
            continue
    raise RuntimeError(f"无法在 {base_dir} 创建临时目录")


def python_executable_in_venv(venv_path: Path) -> Path:
    scripts_dir = "Scripts" if os.name == "nt" else "bin"
    python_name = "python.exe" if os.name == "nt" else "python"
    return venv_path / scripts_dir / python_name


def write_safe_temp_sitecustomize(target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    patch_path = target_dir / "sitecustomize.py"
    patch_path.write_text(SAFE_TEMP_SITECUSTOMIZE, encoding="utf-8")
    return patch_path


def build_bootstrap_env(temp_root: Path) -> dict[str, str]:
    temp_root.mkdir(parents=True, exist_ok=True)
    cache_dir = temp_root / "pip-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    patch_dir = temp_root / "bootstrap-site"
    write_safe_temp_sitecustomize(patch_dir)

    env = os.environ.copy()
    env["TMP"] = str(temp_root)
    env["TEMP"] = str(temp_root)
    env["TMPDIR"] = str(temp_root)
    env["PIP_CACHE_DIR"] = str(cache_dir)

    existing_pythonpath = env.get("PYTHONPATH", "").strip()
    env["PYTHONPATH"] = str(patch_dir) if not existing_pythonpath else os.pathsep.join([str(patch_dir), existing_pythonpath])
    return env


def can_import_yaml_with_python(python_exe: Path, env: dict[str, str] | None = None) -> bool:
    if not python_exe.exists():
        return False
    result = subprocess.run(
        [str(python_exe), "-c", "import yaml"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    return result.returncode == 0


def ensure_venv_python(venv_path: Path) -> tuple[Path | None, str]:
    python_exe = python_executable_in_venv(venv_path)
    if python_exe.exists():
        return python_exe, ""

    venv_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # 先创建不带 pip 的 venv，后续自行在受控临时目录里运行 ensurepip。
        venv.EnvBuilder(with_pip=False).create(str(venv_path))
    except Exception as error:  # pragma: no cover
        return None, f"venv 创建失败: {error}"

    python_exe = python_executable_in_venv(venv_path)
    if not python_exe.exists():
        return None, f"未找到 venv python: {python_exe}"
    return python_exe, ""


def ensure_pip_available(python_exe: Path, temp_env: dict[str, str]) -> tuple[bool, str]:
    pip_check = subprocess.run(
        [str(python_exe), "-m", "pip", "--version"],
        check=False,
        capture_output=True,
        text=True,
        env=temp_env,
    )
    if pip_check.returncode == 0:
        return True, ""

    ensurepip_result = subprocess.run(
        [str(python_exe), "-m", "ensurepip", "--upgrade", "--default-pip"],
        check=False,
        capture_output=True,
        text=True,
        env=temp_env,
    )
    if ensurepip_result.returncode == 0:
        return True, ""

    message = ensurepip_result.stderr.strip() or ensurepip_result.stdout.strip() or "ensurepip failed"
    return False, message


def install_requirements_with_python(
    python_exe: Path,
    requirements: Path,
    temp_env: dict[str, str],
    cache_dir: Path,
    install_mode: str = "",
) -> tuple[bool, str]:
    install_cmd = [
        str(python_exe),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--cache-dir",
        str(cache_dir),
    ]
    if install_mode:
        install_cmd.append(install_mode)
    install_cmd.extend(["-r", str(requirements)])

    install_result = subprocess.run(
        install_cmd,
        check=False,
        capture_output=True,
        text=True,
        env=temp_env,
    )
    if install_result.returncode == 0 and can_import_yaml_with_python(python_exe, env=temp_env):
        return True, ""

    message = install_result.stderr.strip() or install_result.stdout.strip() or "pip install failed"
    return False, message


def parse_simple_frontmatter(frontmatter_text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_line in frontmatter_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise ValueError(f"无法解析的 frontmatter 行: {raw_line}")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        result[key] = value
    return result


def parse_openai_yaml_portable(content: str) -> dict:
    interface_data: dict[str, str] = {}
    in_interface = False
    for raw_line in content.splitlines():
        if not raw_line.strip():
            continue
        if not raw_line.startswith(" ") and not raw_line.startswith("\t"):
            in_interface = raw_line.strip() == "interface:"
            continue
        if not in_interface:
            continue
        stripped = raw_line.strip()
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        interface_data[key.strip()] = value
    return {"interface": interface_data}


def validate_skill_version(skill_path: Path, expected_skill_name: str = "") -> tuple[bool, str, dict[str, object] | None]:
    import re

    version_file = skill_path / "skill-version.json"
    if not version_file.exists():
        return False, "未找到 skill-version.json；这通常表示旧版安装副本", None

    try:
        version_info = json.loads(version_file.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as error:
        return False, f"skill-version.json 解析失败: {error}", None

    if not isinstance(version_info, dict):
        return False, "skill-version.json 必须是 JSON 对象", None

    name = str(version_info.get("name", "")).strip()
    version = str(version_info.get("version", "")).strip()
    release_date = str(version_info.get("releaseDate", "")).strip()
    repo = str(version_info.get("repo", "")).strip()
    capabilities = version_info.get("capabilities")

    if not name:
        return False, "skill-version.json 缺少 'name'", None
    if expected_skill_name and name != expected_skill_name:
        return False, f"skill-version.json 的 name 必须与 SKILL.md 一致: {expected_skill_name}", None
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        return False, f"skill-version.json 的 version 无效: {version or '(empty)'}", None
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", release_date):
        return False, f"skill-version.json 的 releaseDate 无效: {release_date or '(empty)'}", None
    if not re.match(r"^https?://.+", repo):
        return False, f"skill-version.json 的 repo 无效: {repo or '(empty)'}", None
    if not isinstance(capabilities, list) or not capabilities or any(not isinstance(item, str) or not item.strip() for item in capabilities):
        return False, "skill-version.json 的 capabilities 必须是非空字符串数组", None

    return (
        True,
        f"skill-version.json 校验通过 ({name}@{version})",
        {
            "name": name,
            "version": version,
            "releaseDate": release_date,
            "repo": repo,
            "capabilities": capabilities,
        },
    )


def validate_required_structure(skill_path: Path) -> tuple[bool, str]:
    required_paths = [
        skill_path / "scripts",
        skill_path / "references",
        skill_path / "assets",
        skill_path / "skill-version.json",
        skill_path / "agents" / "openai.yaml",
    ]
    for required_path in required_paths:
        if not required_path.exists():
            return False, f"缺少必要路径: {required_path.relative_to(skill_path)}"
    return True, "必要目录结构完整"


def portable_validate(skill_path: Path) -> int:
    import re

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print("未找到 SKILL.md", file=sys.stderr)
        return 1

    content = skill_md.read_text(encoding="utf-8-sig")
    if not content.startswith("---"):
        print("SKILL.md 缺少 YAML frontmatter", file=sys.stderr)
        return 1

    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", content, re.DOTALL)
    if not match:
        print("SKILL.md frontmatter 格式无效", file=sys.stderr)
        return 1

    try:
        frontmatter = parse_simple_frontmatter(match.group(1))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    allowed = {"name", "description", "license", "allowed-tools", "metadata"}
    unexpected = sorted(set(frontmatter.keys()) - allowed)
    if unexpected:
        print(f"SKILL.md frontmatter 存在未允许字段: {', '.join(unexpected)}", file=sys.stderr)
        return 1

    skill_name = frontmatter.get("name", "").strip()
    description = frontmatter.get("description", "").strip()
    if not skill_name:
        print("SKILL.md frontmatter 缺少 'name'", file=sys.stderr)
        return 1
    if not description:
        print("SKILL.md frontmatter 缺少 'description'", file=sys.stderr)
        return 1
    if not re.match(r"^[a-z0-9-]+$", skill_name):
        print(f"技能名 '{skill_name}' 无效", file=sys.stderr)
        return 1
    if skill_name.startswith("-") or skill_name.endswith("-") or "--" in skill_name:
        print(f"技能名 '{skill_name}' 无效", file=sys.stderr)
        return 1
    if len(skill_name) > 64:
        print(f"技能名过长（{len(skill_name)}）", file=sys.stderr)
        return 1
    if "<" in description or ">" in description:
        print("description 不能包含尖括号", file=sys.stderr)
        return 1
    if len(description) > 1024:
        print(f"description 过长（{len(description)}）", file=sys.stderr)
        return 1

    openai_yaml = skill_path / "agents" / "openai.yaml"
    if not openai_yaml.exists():
        print("未找到 agents/openai.yaml", file=sys.stderr)
        return 1

    interface_doc = parse_openai_yaml_portable(openai_yaml.read_text(encoding="utf-8-sig"))
    interface = interface_doc.get("interface", {})
    default_prompt = str(interface.get("default_prompt", "")).strip()
    if f"${skill_name}" not in default_prompt:
        print(f"agents/openai.yaml 的 default_prompt 必须包含 ${skill_name}", file=sys.stderr)
        return 1
    if not interface.get("display_name"):
        print("agents/openai.yaml 缺少 interface.display_name", file=sys.stderr)
        return 1
    if not interface.get("short_description"):
        print("agents/openai.yaml 缺少 interface.short_description", file=sys.stderr)
        return 1

    version_valid, version_message, version_info = validate_skill_version(skill_path, skill_name)
    if not version_valid:
        print(version_message, file=sys.stderr)
        return 1

    structure_valid, structure_message = validate_required_structure(skill_path)
    if not structure_valid:
        print(structure_message, file=sys.stderr)
        return 1

    print(f"便携技能校验通过: {skill_path}")
    print("- skill-md: SKILL.md 校验通过")
    print("- openai-yaml: agents/openai.yaml 校验通过")
    print(f"- skill-version: {version_message}")
    print(f"- structure: {structure_message}")
    print(f"- version: {version_info['name']}@{version_info['version']}")
    print(f"- repo: {version_info['repo']}")
    print(f"- capabilities: {', '.join(version_info['capabilities'])}")
    return 0


def strict_validate_with_yaml(skill_path: Path) -> int:
    import re
    import yaml

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print("未找到 SKILL.md", file=sys.stderr)
        return 1

    content = skill_md.read_text(encoding="utf-8-sig")
    if not content.startswith("---"):
        print("SKILL.md 缺少 YAML frontmatter", file=sys.stderr)
        return 1

    match = re.match(r"^---\r?\n(.*?)\r?\n---", content, re.DOTALL)
    if not match:
        print("frontmatter 格式无效", file=sys.stderr)
        return 1

    frontmatter = yaml.safe_load(match.group(1))
    if not isinstance(frontmatter, dict):
        print("frontmatter 必须是 YAML 字典", file=sys.stderr)
        return 1

    for key in ["name", "description"]:
        if key not in frontmatter:
            print(f"SKILL.md frontmatter 缺少 '{key}'", file=sys.stderr)
            return 1

    openai_yaml = skill_path / "agents" / "openai.yaml"
    if not openai_yaml.exists():
        print("未找到 agents/openai.yaml", file=sys.stderr)
        return 1

    interface_doc = yaml.safe_load(openai_yaml.read_text(encoding="utf-8-sig"))
    default_prompt = (((interface_doc or {}).get("interface") or {}).get("default_prompt") or "").strip()
    skill_name = str(frontmatter["name"]).strip()
    if f"${skill_name}" not in default_prompt:
        print(f"agents/openai.yaml 的 default_prompt 必须包含 ${skill_name}", file=sys.stderr)
        return 1

    version_valid, version_message, version_info = validate_skill_version(skill_path, skill_name)
    if not version_valid:
        print(version_message, file=sys.stderr)
        return 1

    structure_valid, structure_message = validate_required_structure(skill_path)
    if not structure_valid:
        print(structure_message, file=sys.stderr)
        return 1

    print(f"严格技能校验通过: {skill_path}")
    print(f"- skill-version: {version_message}")
    print(f"- version: {version_info['name']}@{version_info['version']}")
    print(f"- repo: {version_info['repo']}")
    print(f"- capabilities: {', '.join(version_info['capabilities'])}")
    return 0


def ensure_yaml_available(skill_path: Path, root: Path, venv_path: Path) -> tuple[bool, str]:
    try:
        import yaml  # noqa: F401

        return True, str(Path(sys.executable).resolve())
    except ModuleNotFoundError:
        pass

    if os.environ.get("PMM_VALIDATOR_BOOTSTRAPPED") == "1":
        return False, "bootstrap-loop-detected"

    requirements = requirements_file(skill_path, root)
    if not requirements.exists():
        return False, f"未找到 requirements 文件: {requirements}"

    errors: list[str] = []
    temp_base = local_temp_root(skill_path, root)
    temp_base.mkdir(parents=True, exist_ok=True)

    existing_python = python_executable_in_venv(venv_path)
    if can_import_yaml_with_python(existing_python):
        return True, str(existing_python)

    temp_root = create_session_dir(temp_base, "session")
    try:
        temp_env = build_bootstrap_env(temp_root)
        cache_dir = temp_root / "pip-cache"

        python_exe, python_error = ensure_venv_python(venv_path)
        if python_exe:
            pip_ready, pip_error = ensure_pip_available(python_exe, temp_env)
            if pip_ready:
                install_ok, install_error = install_requirements_with_python(python_exe, requirements, temp_env, cache_dir)
                if install_ok:
                    return True, str(python_exe)
                errors.append(install_error or "venv pip install failed")
            else:
                errors.append(pip_error or "venv ensurepip failed")
        else:
            errors.append(python_error)

        system_python = Path(sys.executable).resolve()
        system_install_ok, system_install_error = install_requirements_with_python(
            system_python,
            requirements,
            temp_env,
            cache_dir,
            install_mode="--user",
        )
        if system_install_ok and can_import_yaml_with_python(system_python, env=temp_env):
            return True, str(system_python)
        errors.append(system_install_error or "user pip install failed")

        return False, " | ".join(error for error in errors if error)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def rerun_with_python(python_exe: str, args: argparse.Namespace) -> int:
    env = os.environ.copy()
    env["PMM_VALIDATOR_BOOTSTRAPPED"] = "1"
    cmd = [python_exe, __file__, str(resolve_skill_path(args.skill_path)), "--mode", "strict"]
    if args.venv_path:
        cmd.extend(["--venv-path", args.venv_path])
    result = subprocess.run(cmd, check=False, env=env)
    return result.returncode


def main() -> int:
    args = parse_args()
    skill_path = resolve_skill_path(args.skill_path)
    root = project_root(skill_path)

    if args.mode == "portable":
        return portable_validate(skill_path)

    if args.mode == "strict":
        try:
            return strict_validate_with_yaml(skill_path)
        except ModuleNotFoundError as error:
            print(f"严格模式下不可用 PyYAML: {error}", file=sys.stderr)
            return 1

    available, provider = ensure_yaml_available(skill_path, root, local_venv_path(skill_path, root, args.venv_path))
    if available:
        return rerun_with_python(provider, args)

    print(f"PyYAML 自举失败: {provider}", file=sys.stderr)
    print("回退到纯 Python 便携校验...", file=sys.stderr)
    return portable_validate(skill_path)


if __name__ == "__main__":
    sys.exit(main())
