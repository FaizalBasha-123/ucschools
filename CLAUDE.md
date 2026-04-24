# UC School Project - Claude Code Setup

## Overview
This is the UC School AI tutoring project. Claude is configured to use **graphify** for code understanding instead of manually reading files.

## Graphify Integration

**Graphify** is a code metadata generator that provides structured information about the project:
- Project context and file statistics
- Directory tree and file organization
- Markdown documentation index
- Recent changes

### One-Command Update

To refresh all graphify metadata:

\\\powershell
cd "D:/uc-school" && .\init-graphify.ps1
\\\

Or individual commands:

\\\powershell
# Get project context and statistics
.\graphify.cmd context -Root . -Scope external

# Get project directory tree
.\graphify.cmd tree -Root . -Scope external

# List all markdown files
.\graphify.cmd md -Root . -Scope external
\\\

## Generated Metadata

Graphify outputs are stored in:
- \.graphify-context/project-context.txt\ - Project statistics and recent files
- \.graphify-context/project-tree.txt\ - Directory structure
- \.graphify-context/markdown-index.txt\ - All markdown files in project

## Project Structure

### Frontend
- **AI-Tutor-Frontend** - React/Next.js dashboard for students and tutors

### Backend
- **AI-Tutor-Backend** - Node.js/Express API for tutoring system

### Configuration
- \.claude/settings.json\ - Claude Code configuration
- \.claude/memory/\ - Claude memory system for project context

## How Claude Uses Graphify

1. Claude reads graphify outputs to understand project structure
2. When asked about the project, Claude references the metadata
3. For code changes, Claude uses graphify to locate relevant files
4. Memory system stores analysis and findings for future context

## Setup Instructions

1. **Initialize graphify** (run once or after major changes):
   \\\powershell
   .\init-graphify.ps1
   \\\

2. **Claude will automatically use graphify context** for project understanding

3. **Update metadata** whenever project structure changes significantly:
   \\\powershell
   .\init-graphify.ps1
   \\\

## Commands Reference

| Command | Purpose |
|---------|---------|
| \.\init-graphify.ps1\ | Complete one-command initialization |
| \.\graphify.cmd context\ | Get project context |
| \.\graphify.cmd tree\ | Get directory tree |
| \.\graphify.cmd md\ | List markdown files |
| \.\graphify.cmd status\ | Show graphify status |

---

**Last Updated**: 2026-04-24 19:44:07
