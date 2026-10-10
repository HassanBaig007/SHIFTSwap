# AI Usage

AI tools were used to help build and check this project.

## Claude's contribution

Claude was used first to understand the existing project before changes were made. It reviewed:

- The React and Vite frontend
- The Express backend
- The project folders and npm scripts
- The seed-data loading process
- The persistence approach
- The existing test files

This helped us extend the existing application instead of creating a separate application. It also helped identify where to place the claim rules, API workflows, persistence code, and tests.

## Implementation help

AI suggestions were used for:

- Building the deterministic date and time calculations
- Implementing the five claim rules
- Adding structured refusal reasons
- Creating the listing state transitions
- Adding local JSON persistence
- Building the React staff and manager screens
- Writing automated tests and project documentation

The accepted design decisions included:

- Treating clinic timestamps as timezone-free local values
- Saving application state in a local JSON file
- Writing state atomically before reporting a successful mutation
- Processing mutations one at a time within the backend process

## Human verification

The implementation was checked manually and through automated tests. Verification included:

- Comparing the application with the supplied seed file
- Running the backend tests
- Running the frontend build
- Running ESLint
- Testing the API directly
- Testing posting, claiming, unclaiming, rejecting, and approving in the browser
- Testing persistence after restarting the backend

The application intentionally uses actor selection instead of login because authentication was not required. The local JSON store is suitable for this hackathon demo and single-process local use, but a production system would use a transactional database.
