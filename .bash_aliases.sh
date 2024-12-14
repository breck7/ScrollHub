# Useful bash aliases for a ScrollHub server:
alias gs="git status"
push() { for remote in $(git remote); do echo "Pushing to $remote..."; git push $remote --all; done; }
alias x="npm run"

# Scroll
alias sb="scroll list | scroll build"
