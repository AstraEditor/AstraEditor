#!/bin/bash

set -e

VERSION=$($(npm bin)/json -f package.json version)
VERSION=${VERSION/%?/}$(date +%Y%m%d%H%M%S)

echo $VERSION

NODE_ENV=production npm run build
npm --no-git-tag-version version $VERSION
npm publish
