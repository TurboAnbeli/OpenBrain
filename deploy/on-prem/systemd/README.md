# OpenBrain API — systemd (user) unit

Runs the REST (`:8000`) + MCP (`:8080`) server as a persistent, reboot-surviving
`systemd --user` service. This is the native on-prem deployment used on the
OrbStack VM (the `docker/` and `k8s/` siblings are alternative targets).

Reboot persistence requires user lingering (one-time, may need sudo):

```sh
loginctl enable-linger "$USER"
```

## Install / upgrade

```sh
cd ~/workspace/openbrain
chmod +x deploy/on-prem/systemd/start-api.sh
cp deploy/on-prem/systemd/openbrain-api.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now openbrain-api.service
```

## Verify

```sh
systemctl --user status openbrain-api.service
pnpm run api:healthcheck
curl -s http://127.0.0.1:8080/health
```

## Repo-managed checks and restart

```sh
pnpm run api:deploy:check
pnpm run api:restart
```

`api:restart` runs `pnpm build`, reloads the user unit, restarts `openbrain-api.service`, and then calls `openbrain-api-healthcheck.sh`. The healthcheck validates `/health`, `/embedder/info`, and `/documents?limit=1` without requiring admin credentials.

## Notes

- Config is read entirely from `~/workspace/openbrain/.env`
  (`DB_*`, `CIPHER_KEY_PATH`, `OLLAMA_EMBED_MODEL`, `OPENBRAIN_*`). Nothing secret
  is committed.
- Run `pnpm build` before first start / after pulling code.
- `Restart=on-failure` keeps it up; with lingering enabled it starts on boot.
- This supersedes the ad-hoc `node dist/index.js` launch (formerly via a
  `/tmp` script started by the agent), which did not survive reboot.
