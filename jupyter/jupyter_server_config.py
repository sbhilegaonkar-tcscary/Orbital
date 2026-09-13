# Jupyter Server config for ORBITAL local development.
# Started by scripts/jupyter.ps1 / scripts/jupyter.sh from the project .venv.
# Dev-only settings: fixed token, open CORS to the Vite origin, XSRF off.

import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.abspath(os.path.join(_here, "..", "workspace"))
_venv = os.path.abspath(os.path.join(_here, "..", ".venv"))
os.makedirs(_root, exist_ok=True)

# Kernels are launched with the server's own interpreter. If that interpreter
# is not the project venv, ipykernel is missing and every kernel dies at
# start, which looks like a mysterious "kernel never reached alive" error.
# Fail loudly here instead. Start the server with scripts/jupyter.ps1 or .sh.
if os.path.abspath(sys.prefix).lower() != _venv.lower():
    raise SystemExit(
        f"ORBITAL: refusing to start Jupyter Server with {sys.executable}.\n"
        f"Use the project venv: {_venv}\\Scripts\\python -m jupyter_server --config={__file__}"
    )

c = get_config()  # noqa: F821  (provided by jupyter_server)

c.ServerApp.root_dir = _root
c.ServerApp.ip = "127.0.0.1"
c.ServerApp.port = 8888
c.ServerApp.open_browser = False

c.IdentityProvider.token = "orbital-dev"
c.ServerApp.password = ""

c.ServerApp.allow_origin = "http://localhost:5173"
c.ServerApp.allow_credentials = True
c.ServerApp.disable_check_xsrf = True
c.ServerApp.allow_remote_access = False

# Keep kernels alive across app reloads; the app reconnects by session path.
c.MappingKernelManager.cull_idle_timeout = 0
