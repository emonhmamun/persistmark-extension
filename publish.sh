#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# PersistMark — one-shot publisher
#
# Usage:   ./publish.sh <your-github-username>
#
# What it does:
#   1. Replaces the "your-username" placeholder in all files
#   2. Sets the git author to the repository owner
#   3. Links the remote repository
#
# After running it, create the repo on GitHub and push (instructions printed).
# ---------------------------------------------------------------------------
set -euo pipefail

USER="${1:?Usage: ./publish.sh <your-github-username>}"
REPO="persistmark-extension"

echo "==> Replacing placeholder username with: ${USER}"
grep -rl 'your-username' --exclude-dir=.git . | while read -r f; do
  sed -i "s/your-username/${USER}/g" "$f"
  echo "    updated: ${f}"
done

echo "==> Setting git author"
git config user.name  "MD Mamun"
git config user.email "${USER}@users.noreply.github.com"
git commit --amend --reset-author --no-edit --quiet && echo "    commit author updated"

echo "==> Linking remote"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${USER}/${REPO}.git"

echo ""
echo "==================================================================="
echo " NEXT STEPS"
echo "==================================================================="
echo " 1. Open https://github.com/new and create the repository:"
echo "      Name:       ${REPO}"
echo "      Visibility: Public"
echo "      IMPORTANT:  do NOT add a README, .gitignore or license"
echo "                  (they already exist in this project)"
echo ""
echo " 2. Push everything:"
echo "      git push -u origin main"
echo ""
echo " 3. On GitHub, open the repo → Settings → General → Social preview:"
echo "      upload assets/banner.png"
echo ""
echo " 4. Done! Your public repository is live at:"
echo "      https://github.com/${USER}/${REPO}"
echo "==================================================================="
