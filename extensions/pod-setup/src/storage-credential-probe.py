"""Read-only SDK checks; JSON in/out, never credential values or exception messages."""
import configparser
import json
import sys

import boto3
from botocore.config import Config


def main():
    packet = json.load(sys.stdin)
    checks = []
    settings = Config(connect_timeout=10, read_timeout=10, retries={"max_attempts": 0})
    values = {}
    for line in packet.get("wasabi", "").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    access = values.get("access-key", values.get("aws_access_key_id", ""))
    secret = values.get("secret-key", values.get("aws_secret_access_key", ""))
    if access and secret:
        client = boto3.client("s3", endpoint_url="https://s3.us-west-1.wasabisys.com",
                              region_name="us-west-1", aws_access_key_id=access,
                              aws_secret_access_key=secret, config=settings)
        for bucket in ("dreamteam-secrets", "dreamteam-run-artifacts"):
            try:
                client.list_objects_v2(Bucket=bucket, MaxKeys=1)
                checks.append({"service": "wasabi:" + bucket, "status": "verified",
                               "detail": "Authenticated bucket listing; no objects uploaded or modified"})
            except Exception:
                checks.append({"service": "wasabi:" + bucket, "status": "unverifiable",
                               "detail": "Bucket permission, credentials, or network check failed"})
    else:
        checks.append({"service": "wasabi", "status": "missing", "detail": "No bootstrap credential"})
    parser = configparser.ConfigParser()
    parser.read_string(packet.get("aws", ""))
    for section in parser.sections():
        values = parser[section]
        try:
            boto3.client("sts", region_name="us-east-1",
                         aws_access_key_id=values.get("aws_access_key_id"),
                         aws_secret_access_key=values.get("aws_secret_access_key"),
                         aws_session_token=values.get("aws_session_token"),
                         config=settings).get_caller_identity()
            checks.append({"service": "aws:" + section, "status": "verified", "detail": "STS identity verified"})
        except Exception:
            checks.append({"service": "aws:" + section, "status": "unverifiable", "detail": "STS check failed; this may be an S3-compatible key rather than AWS"})
    print(json.dumps(checks))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps([{"service": "storage", "status": "unverifiable", "detail": "SDK or credential format failure"}]))
        sys.exit(1)
