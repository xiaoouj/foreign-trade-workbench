# Optional message connectors

These are separate opt-in services; the main CRM does not start them.

Install dependencies in this directory with `npm install`. Read the environment-variable descriptions at the top of `email-connector.mjs` or `whatsapp-connector.mjs`, then configure your own accounts and `WORKBENCH_URL`. Use the same randomly generated webhook secret as the CRM. No production settings or session files are included.

Use `npm run start:email` or `npm run start:whatsapp` with environment variables exported by your deployment. Authentication/session data must remain outside Git. For containers, use the included Dockerfile and provide service-specific environment variables and persistent storage yourself.
