import os, psycopg

env_path = os.path.expanduser("~/workspace/openbrain/.env")
vars={}
for line in open(env_path):
    if line.strip() and not line.startswith("#") and "=" in line:
        k,v=line.strip().split("=",1)
        vars[k]=v.strip().strip('"')

conn = psycopg.connect(
    host=vars.get("DB_HOST","127.0.0.1"),
    port=int(vars.get("DB_PORT","5432")),
    user=vars["DB_USER"],
    password=vars["DB_PASSWORD"],
    dbname=vars["DB_NAME"],
)
conn.autocommit=True
cur=conn.cursor()
cur.execute("DELETE FROM experiences WHERE event_type='recall_routing'")
print("deleted recall_routing rows:", cur.rowcount)

# sanity counts
cur.execute("SELECT count(*) FROM experiences WHERE event_type='recall_routing'")
print("remaining recall_routing rows:", cur.fetchone()[0])
cur.execute("SELECT count(*) FROM experiences")
print("total experiences:", cur.fetchone()[0])
