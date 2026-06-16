import psycopg, os, json

def build_db_url():
    env_path = os.path.expanduser("~/.config/openbrain/openbrain.env")
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.strip() and not line.startswith("#") and "=" in line:
                k,v=line.strip().split("=",1)
                os.environ.setdefault(k,v.strip('"'))
    if "DATABASE_URL" in os.environ:
        return os.environ["DATABASE_URL"]
    repo_env = os.path.expanduser("~/workspace/openbrain/.env")
    if os.path.exists(repo_env):
        vars={}
        for line in open(repo_env):
            if line.strip() and not line.startswith("#") and "=" in line:
                k,v=line.strip().split("=",1)
                vars[k]=v.strip().strip('"')
        return f"postgresql://{vars['DB_USER']}:{vars['DB_PASSWORD']}@{vars.get('DB_HOST','127.0.0.1')}:{vars.get('DB_PORT','5432')}/{vars['DB_NAME']}"
    raise RuntimeError("Cannot locate database credentials")

conn = psycopg.connect(build_db_url())
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT count(*) FROM experiences WHERE event_type='recall_routing' AND created_at > now() - interval '2 minutes'")
print("recent recall_routing experiences:", cur.fetchone()[0])
cur.execute("SELECT id, event_type, refs FROM experiences WHERE event_type='recall_routing' ORDER BY created_at DESC LIMIT 5")
def scan_object(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            key_path = f"{path}.{k}" if path else k
            assert k not in ("query", "raw_query"), f"forbidden key '{k}' at {key_path}"
            scan_object(v, key_path)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            scan_object(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        # Reason codes like 'title_like_query' are safe; actual user text must not appear.
        for term in sensitive_terms:
            assert term not in obj, f"sensitive term '{term}' leaked at {path}: {obj}"

sensitive_terms = ["OAuth", "memory lookup", "Claude AI", "Connector Failure", "oauth connector retries"]

for id, event_type, refs in cur.fetchall():
    refs_obj = json.dumps(refs, indent=2) if isinstance(refs, dict) else str(refs)
    print(id, event_type, refs_obj)
    scan_object(refs)
print("privacy scan passed")
