# Sign the integration tests in as the System view administrator.
#
# Every /api/system route needs a bearer token. This logs in once and installs a
# urllib opener that adds the Authorization header to every later request.

import json
import urllib.request

from backend.app.routes.auth import ADMIN_PASSWORD, ADMIN_USERNAME


def sign_in(server_root):
    body = json.dumps({"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}).encode()
    req = urllib.request.Request(server_root.rstrip("/") + "/api/auth/login", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        token = json.load(res)["data"]["token"]
    opener = urllib.request.build_opener()
    opener.addheaders = [("Authorization", f"Bearer {token}")]
    urllib.request.install_opener(opener)
