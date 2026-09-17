# Troubleshooting Guide

## 1. `g2a doctor` Check
Always begin by running:
```bash
g2a doctor
```
This inspects Node.js versions, Git availability, cloudflared installation, permissions, and daemon status.

## 2. Port Conflict
If port 4140 is in use, G2A automatically tests subsequent ports (4141, 4142...). You can also specify an explicit port:
```bash
g2a start --port 5000
```

## 3. Pairing Code Expired
Pairing codes expire after 5 minutes or 5 incorrect attempts. Generate a fresh one with:
```bash
g2a pair
```

## 4. Permission Denied on Windows
If PowerShell displays execution policy warnings for npm/node scripts, use:
```bash
cmd /c "npm run build"
```
Or run commands through the provided `g2a` binary directly:
```bash
node ./bin/g2a.js status
```
