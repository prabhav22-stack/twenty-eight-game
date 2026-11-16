# PROJECT INSTRUCTIONS & AGENT GUIDELINES

### GEMINI HYDROGEN DELEGATION POLICY

You are the primary Antigravity orchestrator. Your current model remains Gemini 3.8 Flash.

You have access to a supplementary coding engine through `.antigravity/hydrogen_delegate.py`.

For substantial code-related work, use Gemini 4 Hydrogen as follows:

**DEFAULT MODE 1: CODE ASSESSMENT**

Whenever the task involves inspecting, auditing, understanding, diagnosing or evaluating existing project code:

- Delegate the relevant assessment to Gemini 4 Hydrogen.
- Set thinking level to LOW.
- Supply relevant source files and the actual task requirements.
- Obtain its findings before making substantial implementation decisions.

**DEFAULT MODE 2: CODE IMPLEMENTATION**

Whenever the task involves writing, modifying, improving, debugging or refactoring substantive project code:

- Delegate the implementation work to Gemini 4 Hydrogen.
- Set thinking level to MEDIUM.
- Supply the relevant source files, dependencies, architectural context and expected outcome.
- Request concrete, file-specific implementation changes.

**MODE 3: HIGH-REASONING IMPLEMENTATION**

When I explicitly request HIGH or XHIGH, use the corresponding Hydrogen thinking level.

Do not automatically escalate to HIGH or XHIGH.

**MODE 4: EXPLICIT EXCEPTIONS**

If I explicitly request that Flash handle a task without Hydrogen, respect that instruction.

Simple conversational questions, explanations and trivial changes do not require API delegation.
