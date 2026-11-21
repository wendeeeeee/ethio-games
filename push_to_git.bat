@echo off
git remote remove origin 2>nul
git remote add origin https://github.com/wendeeeeee/ethio-games.git
git branch -M main
git add .
git commit -m "feat: complete Ethiopian Conquer and Seka platform with rules, registration, 1-min table expiration and responsive design"
git push -u origin main
