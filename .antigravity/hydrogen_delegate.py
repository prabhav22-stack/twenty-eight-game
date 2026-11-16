#!/usr/bin/env python3
"""
hydrogen_delegate.py - Gemini 4 Hydrogen API Delegation Helper for Antigravity

Delegates substantive code review and implementation tasks to Gemini 4 Hydrogen
via the Google Gemini REST API using Python's standard library.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# API Endpoint & Model Configuration
DEFAULT_MODEL = "gemini-4-hydrogen"
API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Supported Thinking Levels
VALID_THINKING_LEVELS = {
    "LOW": "LOW",
    "MEDIUM": "MEDIUM",
    "HIGH": "HIGH",
    "XHIGH": "XHIGH",
}

# Blocklist for sensitive files/patterns to prevent accidental transmission
FORBIDDEN_NAME_PATTERNS = {
    ".env", ".env.local", ".env.production", ".env.development",
    ".git", "id_rsa", "id_ed25519", "secrets.toml"
}

FORBIDDEN_EXTENSIONS = {
    ".pem", ".key", ".pfx", ".p12", ".crt", ".der",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".zip", ".tar", ".gz",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf"
}

FORBIDDEN_DIR_PARTS = {
    ".git", "node_modules", ".venv", "venv", "env", "__pycache__"
}


def sanitize_text(text: str, secret: str) -> str:
    """Masks secret key from any text/error message."""
    if not secret:
        return text
    return text.replace(secret, "[REDACTED_API_KEY]")


def is_file_safe_to_transmit(file_path: Path) -> tuple[bool, str]:
    """Validates that a file does not contain private credentials or unsupported binary formats."""
    # Check filename
    name_lower = file_path.name.lower()
    if name_lower in FORBIDDEN_NAME_PATTERNS or name_lower.startswith(".env"):
        return False, f"Refusing to transmit credential file: {file_path.name}"

    # Check extension
    if file_path.suffix.lower() in FORBIDDEN_EXTENSIONS:
        return False, f"Refusing to transmit binary or sensitive extension ({file_path.suffix}): {file_path.name}"

    # Check directory path components
    for part in file_path.parts:
        if part.lower() in FORBIDDEN_DIR_PARTS:
            return False, f"Refusing to transmit file inside restricted directory '{part}': {file_path}"

    # Check binary content by probing null bytes in the first 4KB
    try:
        with open(file_path, "rb") as f:
            chunk = f.read(4096)
            if b"\x00" in chunk:
                return False, f"Refusing to transmit binary file: {file_path}"
    except Exception as e:
        return False, f"Unable to read file '{file_path}': {e}"

    return True, ""


def build_system_instruction(mode: str) -> str:
    """Generates the mode-specific framing for Gemini 4 Hydrogen."""
    if mode.lower() == "review":
        return (
            "You are Gemini 4 Hydrogen, an expert supplementary coding and auditing engine.\n"
            "MODE: REVIEW\n"
            "Responsibilities:\n"
            "- Inspect the supplied code thoroughly against the task requirements.\n"
            "- Identify bugs, edge cases, performance bottlenecks, race conditions, and architectural weaknesses.\n"
            "- Return evidence-based findings, clear file references (with line numbers or identifiers), and prioritized actionable recommendations.\n"
            "- Do not claim to have modified files; provide read-only review feedback."
        )
    elif mode.lower() == "implement":
        return (
            "You are Gemini 4 Hydrogen, an expert supplementary coding execution engine.\n"
            "MODE: IMPLEMENT\n"
            "Responsibilities:\n"
            "- Implement the requested improvements and bug fixes conceptually and concretely.\n"
            "- Produce concrete code changes, preferably as unified diffs or complete replacement blocks for targeted sections.\n"
            "- Explicitly identify affected files and explain important implementation decisions and trade-offs.\n"
            "- Respect the project's existing conventions, patterns, and dependencies.\n"
            "- Do not claim that files have already been modified on disk."
        )
    else:
        return "You are Gemini 4 Hydrogen, an expert coding engine. Assist with the requested task."


def build_contents_payload(task_desc: str, context_files: list[Path]) -> list[dict]:
    """Constructs the prompt contents including attached source files."""
    user_parts = []

    # Attach contextual files
    if context_files:
        files_header = "### PROJECT CONTEXT FILES:\n"
        for fpath in context_files:
            try:
                content = fpath.read_text(encoding="utf-8", errors="replace")
                files_header += f"\n--- FILE: {fpath.as_posix()} ---\n{content}\n--- END OF FILE: {fpath.as_posix()} ---\n"
            except Exception as e:
                sys.stderr.write(f"Warning: Could not read context file {fpath}: {e}\n")
        user_parts.append({"text": files_header})

    # Attach task instructions
    task_header = f"### TASK INSTRUCTIONS:\n{task_desc.strip()}\n"
    user_parts.append({"text": task_header})

    return [{"role": "user", "parts": user_parts}]


def invoke_gemini_hydrogen(
    api_key: str,
    model: str,
    thinking_level: str,
    system_instruction: str,
    contents: list[dict],
    timeout: int = 120,
) -> tuple[str, dict]:
    """Invokes the Gemini 4 Hydrogen generateContent REST API."""
    url = f"{API_BASE_URL}/{model}:generateContent"

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    body = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "thinkingConfig": {
                "thinkingLevel": thinking_level
            }
        },
    }

    req_data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=req_data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.getcode()
            raw_data = response.read().decode("utf-8")
            res_json = json.loads(raw_data)
            return res_json, {"status": status_code}
    except urllib.error.HTTPError as e:
        err_msg = ""
        try:
            err_body = e.read().decode("utf-8")
            err_json = json.loads(err_body)
            err_msg = err_json.get("error", {}).get("message", err_body)
        except Exception:
            err_msg = str(e)
        sanitized = sanitize_text(f"HTTP Error {e.code}: {err_msg}", api_key)
        raise RuntimeError(sanitized) from None
    except urllib.error.URLError as e:
        sanitized = sanitize_text(f"Network / URL Error: {e.reason}", api_key)
        raise RuntimeError(sanitized) from None
    except Exception as e:
        sanitized = sanitize_text(f"API Request Failure: {str(e)}", api_key)
        raise RuntimeError(sanitized) from None


def parse_response_text(res_json: dict) -> str:
    """Extracts the generated text response from the API response object."""
    candidates = res_json.get("candidates", [])
    if not candidates:
        prompt_feedback = res_json.get("promptFeedback", {})
        block_reason = prompt_feedback.get("blockReason")
        if block_reason:
            raise RuntimeError(f"Request blocked by safety/policy filter: {block_reason}")
        raise RuntimeError("API returned empty candidates list without generated content.")

    first_candidate = candidates[0]
    finish_reason = first_candidate.get("finishReason")
    content = first_candidate.get("content", {})
    parts = content.get("parts", [])

    output_chunks = []
    for part in parts:
        if "text" in part:
            output_chunks.append(part["text"])

    if not output_chunks:
        if finish_reason and finish_reason != "STOP":
            raise RuntimeError(f"No text returned. Finish reason: {finish_reason}")
        raise RuntimeError("No text parts found in candidate content.")

    return "".join(output_chunks)


def resolve_api_key() -> str:
    """Retrieves GEMINI_API_KEY from environment or local .env/.env.local files."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key

    # Check local .env / .env.local files in project root as fallback
    search_dirs = [Path.cwd(), Path(__file__).resolve().parent.parent]
    for directory in search_dirs:
        for fname in [".env.local", ".env"]:
            env_file = directory / fname
            if env_file.is_file():
                try:
                    for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                        line = line.strip()
                        if line.startswith("GEMINI_API_KEY="):
                            val = line.split("=", 1)[1].strip().strip("\"'")
                            if val:
                                return val
                except Exception:
                    pass
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="Delegate substantive code tasks to Gemini 4 Hydrogen via Google Gemini REST API."
    )
    parser.add_argument(
        "--mode",
        choices=["review", "implement"],
        default="review",
        help="Delegation mode: 'review' (assessment/audit) or 'implement' (diffs/code changes). Default: review.",
    )
    parser.add_argument(
        "--effort",
        choices=["LOW", "MEDIUM", "HIGH", "XHIGH", "low", "medium", "high", "xhigh"],
        default=None,
        help="Thinking level for Gemini 4 Hydrogen. Defaults: LOW for review, MEDIUM for implement.",
    )
    parser.add_argument(
        "--task",
        type=str,
        default=None,
        help="Inline task description text.",
    )
    parser.add_argument(
        "--task-file",
        type=str,
        default=None,
        help="Path to file containing task description.",
    )
    parser.add_argument(
        "--file", "-f",
        dest="files",
        nargs="+",
        default=[],
        help="One or more project file paths to provide as context.",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Path to write the output response. If omitted, prints to stdout.",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Target Gemini model. Default: {DEFAULT_MODEL}.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="API request timeout in seconds. Default: 120.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate parameters and construct payload without sending API request.",
    )

    args = parser.parse_args()

    # 1. Check API Key
    api_key = resolve_api_key()
    if not api_key and not args.dry_run:
        sys.stderr.write(
            "ERROR: GEMINI_API_KEY environment variable is not set.\n"
            "Please configure your Google AI Studio API key:\n"
            "  Windows PowerShell: $env:GEMINI_API_KEY=\"your-api-key\"\n"
            "  Linux / macOS:      export GEMINI_API_KEY=\"your-api-key\"\n"
        )
        sys.exit(2)

    # 2. Resolve Task Description
    task_desc = ""
    if args.task_file:
        task_path = Path(args.task_file)
        if not task_path.is_file():
            sys.stderr.write(f"ERROR: Task file '{args.task_file}' not found.\n")
            sys.exit(1)
        try:
            task_desc = task_path.read_text(encoding="utf-8")
        except Exception as e:
            sys.stderr.write(f"ERROR: Failed to read task file '{args.task_file}': {e}\n")
            sys.exit(1)
    elif args.task:
        task_desc = args.task
    else:
        sys.stderr.write("ERROR: Either --task or --task-file must be provided.\n")
        sys.exit(1)

    if not task_desc.strip():
        sys.stderr.write("ERROR: Task description cannot be empty.\n")
        sys.exit(1)

    # 3. Resolve Thinking Level (Default: LOW for review, MEDIUM for implement)
    mode = args.mode.lower()
    if args.effort:
        thinking_level = args.effort.upper()
    else:
        thinking_level = "LOW" if mode == "review" else "MEDIUM"

    if thinking_level not in VALID_THINKING_LEVELS:
        sys.stderr.write(f"ERROR: Invalid thinking level '{thinking_level}'. Choose from LOW, MEDIUM, HIGH, XHIGH.\n")
        sys.exit(1)

    # 4. Resolve Context Files & Verify Safety
    validated_files = []
    for f_str in args.files:
        f_path = Path(f_str).resolve()
        if not f_path.is_file():
            sys.stderr.write(f"ERROR: Context file '{f_str}' does not exist or is not a file.\n")
            sys.exit(1)
        safe, reason = is_file_safe_to_transmit(f_path)
        if not safe:
            sys.stderr.write(f"SECURITY ERROR: {reason}\n")
            sys.exit(1)
        validated_files.append(f_path)

    # 5. Build System Instruction and User Payload
    system_instruction = build_system_instruction(mode)
    contents = build_contents_payload(task_desc, validated_files)

    # 6. Dry-run Mode
    if args.dry_run:
        summary = {
            "mode": mode,
            "model": args.model,
            "thinkingLevel": thinking_level,
            "contextFilesCount": len(validated_files),
            "files": [str(p) for p in validated_files],
            "taskLengthChars": len(task_desc),
        }
        print(json.dumps(summary, indent=2))
        sys.exit(0)

    # 7. Invoke Gemini 4 Hydrogen
    sys.stderr.write(
        f"[Hydrogen Delegate] Delegating to {args.model} | Mode: {mode.upper()} | "
        f"Thinking: {thinking_level} | Files: {len(validated_files)}...\n"
    )

    try:
        res_json, meta = invoke_gemini_hydrogen(
            api_key=api_key,
            model=args.model,
            thinking_level=thinking_level,
            system_instruction=system_instruction,
            contents=contents,
            timeout=args.timeout,
        )
    except Exception as e:
        sys.stderr.write(f"ERROR: Delegation request failed: {e}\n")
        sys.exit(1)

    # 8. Parse Output
    try:
        response_text = parse_response_text(res_json)
    except Exception as e:
        sys.stderr.write(f"ERROR: Failed to parse model response: {e}\n")
        sys.exit(1)

    # 9. Log Token Usage to stderr
    usage = res_json.get("usageMetadata", {})
    if usage:
        prompt_tokens = usage.get("promptTokenCount", 0)
        resp_tokens = usage.get("candidatesTokenCount", 0)
        sys.stderr.write(
            f"[Hydrogen Delegate] Success: Response received ({resp_tokens} tokens, prompt was {prompt_tokens} tokens).\n"
        )

    # 10. Write Output
    if args.output:
        out_path = Path(args.output)
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(response_text, encoding="utf-8")
            sys.stderr.write(f"[Hydrogen Delegate] Response written to {args.output}\n")
        except Exception as e:
            sys.stderr.write(f"ERROR: Failed to write output file '{args.output}': {e}\n")
            sys.exit(1)
    else:
        # Write to stdout
        sys.stdout.write(response_text)
        if not response_text.endswith("\n"):
            sys.stdout.write("\n")
        sys.stdout.flush()

    sys.exit(0)


if __name__ == "__main__":
    main()
