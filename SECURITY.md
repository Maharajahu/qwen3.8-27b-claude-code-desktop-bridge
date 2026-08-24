# Security

The bridge binds to `127.0.0.1` by default. Keep it local unless you add a
production authentication layer, TLS, rate limits, request-size policy and a
firewall boundary.

Do not report model safety behavior as a bridge vulnerability. Report issues
that allow unauthorized access, credential disclosure, command execution in
the bridge process, cross-client request leakage, or bypass of configured
authentication.

Never include real gateway keys, Claude settings, prompts or local file paths
from another user in a public issue.

