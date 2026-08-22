"""
One-off CLI script to create a user directly in Oracle - most importantly,
the very first admin account, since there is no unauthenticated "create
first admin" endpoint in the API (deliberately: that would be a security
hole sitting in production).

Usage (run from the backend/ directory, with the venv active):

    python -m scripts.create_user --username nora --password "changeme123" \
        --nom Nora --prenom Alaoui --role admin

    python -m scripts.create_user --username kaoutar --password "changeme123" \
        --nom Kaoutar --prenom Benali --role scanner --ip-poste 192.168.1.42

Re-running with an existing username will fail cleanly (unique index) -
use the admin API (PATCH /admin/users/{id}) to update an existing account
instead.
"""
from __future__ import annotations

import argparse
import asyncio
import time
import uuid

from app.auth import hash_password
from app.db import DuplicateKeyError, connect_and_init, close, get_db


async def create_user(args: argparse.Namespace) -> None:
    await connect_and_init()
    db = get_db()
    doc = {
        "_id": uuid.uuid4().hex,
        "username": args.username,
        "password_hash": hash_password(args.password),
        "nom": args.nom,
        "prenom": args.prenom,
        "role": args.role,
        "ip_poste": args.ip_poste,
        "date_creation": time.time(),
        "statut": "actif",
    }
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        print(f"Erreur : le nom d'utilisateur '{args.username}' existe déjà.")
        raise SystemExit(1)
    finally:
        await close()
    print(f"Utilisateur '{args.username}' ({args.role}) créé avec succès.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a user (e.g. the first admin).")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--nom", required=True)
    parser.add_argument("--prenom", required=True)
    parser.add_argument("--role", choices=["admin", "scanner"], default="scanner")
    parser.add_argument("--ip-poste", default=None)
    args = parser.parse_args()

    asyncio.run(create_user(args))


if __name__ == "__main__":
    main()
