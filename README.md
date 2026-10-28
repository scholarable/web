# Scholarable

The web app behind [scholarable.de](https://scholarable.de): students say what they study and what they need, and get the scholarships that fit them, with deadlines and what to prepare.

This is a public copy of the web app's code, published for reference. The data pipeline that finds and checks scholarships, the research behind it and the real data are private, so this copy doesn't run end to end on its own.

## What's here

- `app/`: the React Router app in TypeScript: browsing, matching, the discovery chat, student accounts, saved progress and documents
- `workers/`: the Cloudflare Worker entry points for the app and the public demo
- `scanner/`: the document scanner that checks student uploads for malware before they're stored
- `scripts/`: the demo and HTTP checks

## Run the checks

```sh
npm install
npm test
npm run check
npm run build
```

There is no open-source license: you're welcome to read the code, and all rights are reserved.
