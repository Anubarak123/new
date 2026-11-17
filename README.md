# Digital Tools Quiz

A web app for classroom use: the professor maintains a library of digital tools grouped by category and configures the quiz, and students take a timed quiz by sorting tools into the correct categories. Results and attempts are stored for review and export.

**Live app:** https://digital-tools-quiz.onrender.com

## Repository layout

| Path | Contents |
| --- | --- |
| `client/` | React + Vite front end (student and professor views) |
| `server/` | Express 5 API, Prisma data access, authentication, quiz logic |
| `prisma/` | Database schema, migrations, and seed script |

## Stack

React 19, Vite 7, react-router, @dnd-kit for drag and drop · Express 5, Prisma 6, PostgreSQL (hosted on Neon) · npm workspaces.

## Documentation

Full setup, configuration, deployment, and verification notes live in [`ToolQuiz/README.md`](ToolQuiz/README.md).
