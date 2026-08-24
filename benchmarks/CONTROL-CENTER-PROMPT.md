# Local Model Control Center benchmark prompt

Use this prompt unchanged for every candidate model. Give every run a fresh
isolated folder and identical harness, context, permissions, tools and
reasoning effort.

```text
In folderul tau creaza un folder cu TEST CLAUDE iar acolo vei construi asta

Build a polished local web application called “Local Model Control Center” in a new isolated folder.

It should automatically discover my existing local-AI services and display, live:

- currently loaded model, runtime, mode and context
- GPU VRAM, utilization, temperature and power
- RAM usage
- prompt-processing speed and generation tokens/second
- MTP acceptance rate and draft statistics
- active requests and request duration
- recent llama.cpp, router and gateway errors

Add controls for:

- selecting a configured model
- automatic safe model swap
- unloading the active model
- switching between text and vision
- choosing reasoning level
- testing text and image prompts
- viewing live streamed output and performance metrics

Requirements:

- clean dark responsive interface
- backend and frontend must be properly separated
- automatic reconnect when a service restarts
- never freeze the UI during model loading
- do not modify or delete my existing models or configurations
- place everything inside the new project folder
- add meaningful automated tests
- provide a one-command launcher
- verify every feature yourself using the existing local services
- if something fails, diagnose and repair it instead of stopping
- preserve everything that already works

Inspect the machine and existing services yourself. Create a plan, implement it, run it, test it, and keep fixing defects until the application is genuinely working. Do not ask me technical questions unless you are completely blocked.
```

For the next model, change only the destination folder name so the candidate
cannot inspect or overwrite another model's implementation.

