# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added
- Repository skeleton: `infra/`, `api/`, `web/`, `mcp/` and `packages/schema/`.
- JSON Schema for test guides (`packages/schema/guide.schema.json`) with an example guide.
- Default instructions for AI agents on writing and updating guides (`packages/schema/guide-instructions.md`).
- MCP server design (`mcp/DESIGN.md`): tools, agent tokens, per-tester results with combined verdicts.
- Environments: configurable per instance (set at deploy, editable by owners); guides list the environments they must be run on, scenarios can be limited to some of them, runs and verdicts are per environment.
- Deployment model: one instance per project in the project's AWS account, on a subdomain; draft Terraform variables and three DNS options in `infra/README.md`.
- README with core concepts, MIT license.
