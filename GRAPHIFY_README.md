# Graphify Setup for UC School

> **One-Command Code Understanding for Claude**

Graphify is a code metadata generator that provides Claude with structured project information without manual file reading. This allows Claude to work more efficiently with the UC School codebase.

## Quick Start

### 1️⃣ One-Command Initialization

```powershell
cd D:\uc-school
.\graphify-uc-school.cmd init
```

That's it! This will:
- ✅ Generate project metadata
- ✅ Create Claude integration files
- ✅ Set up memory system for future context
- ✅ Index all project files

### 2️⃣ Claude Will Automatically Use Graphify

Once initialized, Claude will:
- 📖 Read graphify outputs instead of manually scanning files
- 🎯 Locate relevant code faster
- 💾 Remember project context across sessions
- 🚀 Work more efficiently

## Generated Files

After running `init`, you'll have:

```
.graphify-context/
├── project-context.txt      # Project stats and recent changes
├── project-tree.txt         # Directory structure
└── markdown-index.txt       # All documentation files

.claude/
├── settings.json            # Claude configuration
└── memory/
    └── 01-graphify-system.md # Graphify metadata
```

## Available Commands

```powershell
# Initialize (run once or after major changes)
.\graphify-uc-school.cmd init

# Refresh all metadata
.\graphify-uc-school.cmd refresh

# View project context
.\graphify-uc-school.cmd context

# View project tree
.\graphify-uc-school.cmd tree

# List markdown files
.\graphify-uc-school.cmd md

# Help
.\graphify-uc-school.cmd help
```

## Project Statistics

From graphify output:

- **Total Files**: 115,908
- **Markdown Docs**: 3,197
- **TypeScript/TSX**: 25,962
- **Go Code**: 143
- **Rust Code**: 653

## Project Structure

The UC School project contains:

```
D:/uc-school/
├── AI-Tutor-Backend/      # Node.js/Express API
├── AI-Tutor-Frontend/     # React/Next.js dashboard
├── Schools24-frontend/    # React frontend
├── client/                # Mobile client
└── [configuration files]
```

## How Claude Uses Graphify

```
User: "What files are in the project?"
     ↓
Claude reads .graphify-context/project-tree.txt
     ↓
Claude responds with accurate structure
     ↓
Claude remembers in .claude/memory/
```

## When to Refresh

Run `.\graphify-uc-school.cmd refresh` after:
- Adding new directories
- Major refactoring
- Adding new documentation
- Significant file reorganization

Regular code changes do NOT require refresh.

## For Claude AI

If you're Claude working with this project:

1. **First task**: Check if graphify outputs exist in `.graphify-context/`
2. **Understanding code**: Reference `project-tree.txt` for structure
3. **Finding files**: Use `markdown-index.txt` for documentation
4. **Project context**: Read `project-context.txt` for stats and recent files
5. **Remember**: Store findings in `.claude/memory/` for future sessions

## Troubleshooting

**Problem**: `graphify.cmd not found`
```powershell
# Make sure you're in D:\uc-school
cd D:\uc-school

# Check files exist
ls graphify.cmd
ls scripts\graphify.ps1
```

**Problem**: PowerShell execution policy
```powershell
# The init script handles this, but if needed:
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope CurrentUser -Force
```

**Problem**: Metadata is outdated
```powershell
# Refresh it
.\graphify-uc-school.cmd refresh
```

## Integration with Claude Code

Claude automatically:
- ✅ Reads generated metadata files
- ✅ Uses graphify context for code understanding
- ✅ Stores findings in memory system
- ✅ References .claude/settings.json

No additional configuration needed!

## Single-Command Workflow

```powershell
# Complete setup in one command
cd D:\uc-school && .\graphify-uc-school.cmd init
```

That's all! Claude is ready to work with your code efficiently.

---

**Last Updated**: 2026-04-24  
**Status**: ✅ Ready for Production
