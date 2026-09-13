# Jupyter Server config for ORBITAL local development.
# Started by scripts/jupyter.ps1 / scripts/jupyter.sh from the project .venv.
# Dev-only settings: fixed token, open CORS to the Vite origin, XSRF off.

import os

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.abspath(os.path.join(_here, "..", "workspace"))
os.makedirs(_root, exist_ok=True)

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
