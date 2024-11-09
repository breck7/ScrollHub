#!/bin/bash

# run this command to add git acp command for updating remote server
##git config --global alias.acp '!./git_acp.sh'

# Remote server details
REMOTE_USER="username@hostname.com"
REMOTE_REPO_PATH="/path/to/repo/"

# Execute remote commands
ssh $REMOTE_USER "cd $REMOTE_REPO_PATH && git status && if [ -n \"\$(git status --porcelain)\" ]; then git add . && git commit -m 'Remote commit'; fi && git pull && sleep 2"

# Delay to ensure remote commands complete
sleep 2

# Pull remote changes before adding and committing local changes
git pull

# Add and commit local changes
git add .
git commit -m "local update"
sleep 2

# Push local changes to remote
git push
