K3d (Dev): k3d cluster create schools24 -p "8080:80@loadbalancer"
Kind (Test): kind create cluster --config kind-config.yaml
OKE (Prod): oci ce cluster create-kubeconfig --cluster-id <ocid>

md to pdf : 
markdown-pdf -o SCHOOLS24-WEEK-4-CLIENT-REPORT.pdf WEEK-4-CLIENT-REPORT.md 2>&1

# When you make frontend changes:
.\push-frontend.ps1 "Your commit message here"

# When you start both ends.
.\start_all.ps1

# Update DB schema tree (writes DB_SCHEMA_TREE.md)
# Requires DATABASE_URL (loaded from Schools24-backend/.env)
cd Schools24-backend
go run .\cmd\tools\update_schema_tree.go
cd ..

# Run backend
cd D:\Schools24-Workspace\Schools24-backend
go run cmd/server/main.go

# Run frontend
cd D:\Schools24-Workspace\Schools24-frontend
npm run dev

# adb testing the app
cd d:\Schools24-Workspace\Schools24-frontend; $env:NODE_ENV = "production"; npx cap sync android; cd ..\client\android-mobile; .\gradlew.bat assembleDebug; adb install -r app\build\outputs\apk\debug\app-debug.apk; adb shell am start -n in.schools24.app/.MainActivity
