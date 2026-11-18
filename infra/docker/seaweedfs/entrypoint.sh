#!/bin/sh
# Local development only. Writes the SeaweedFS S3 identity file from
# environment variables (so no credentials are committed), then starts a
# single-node SeaweedFS server with the S3 gateway enabled.
set -eu

: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

cat > /tmp/s3.json <<JSON
{
  "identities": [
    {
      "name": "local-dev",
      "credentials": [
        { "accessKey": "${S3_ACCESS_KEY_ID}", "secretKey": "${S3_SECRET_ACCESS_KEY}" }
      ],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON

exec weed server -dir=/data -s3 -s3.port=8333 -s3.config=/tmp/s3.json -master.volumeSizeLimitMB=1024
