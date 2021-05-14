#!/bin/bash

VERSION=$($(npm bin)/json -f package.json version)
VERSION=${VERSION/%?/}$(date +%Y%m%d%H%M%S)

echo $VERSION

npm run build
npm --no-git-tag-version version $VERSION
npm publish
