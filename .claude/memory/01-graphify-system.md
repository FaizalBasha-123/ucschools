---
name: Graphify System for UC School
description: Graphify code metadata generator configured for UC School project
type: reference
---

# Graphify System - UC School

## What is Graphify

Graphify is a code metadata generator that provides structured information about the UC School project without requiring manual file reads.

## Access Methods

**One-command refresh**:
\\\powershell
cd "D:/uc-school" && .\init-graphify.ps1
\\\

**Individual commands**:
- Context: \.\graphify.cmd context -Root . -Scope external\
- Tree: \.\graphify.cmd tree -Root . -Scope external\
- Markdown: \.\graphify.cmd md -Root . -Scope external\

## Output Files

Located in \.graphify-context/\:
- **project-context.txt** — Statistics, file counts, recent changes
- **project-tree.txt** — Directory structure and organization
- **markdown-index.txt** — All documentation files

## Usage Pattern

When working on UC School:
1. Claude reads graphify outputs automatically
2. Use graphify to understand project structure before making changes
3. Update metadata with \.\init-graphify.ps1\ after structural changes
4. All metadata is version-controlled in .graphify-context/

## Project Structure (from graphify)

- **AI-Tutor-Frontend** — React/Next.js dashboard
- **AI-Tutor-Backend** — Node.js/Express backend
- Markdown docs in root directory
- Configuration files (.claude, .github, .vscode, etc.)
