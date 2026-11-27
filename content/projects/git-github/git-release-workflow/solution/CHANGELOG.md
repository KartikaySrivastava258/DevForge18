# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-01-15

### Fixed

- `compare` now compares version parts as numbers, so 1.10.0 sorts after 1.9.0 (it sorted before).
- `parse` returns numbers instead of strings for the three parts.

### Added

- Tests run automatically on every push to main and every pull request.
- Pushing a tag such as `v1.0.0` runs the tests and publishes a GitHub release with this changelog's notes.

## [0.9.0] - 2026-01-15

### Added

- `parse` and `compare` for `MAJOR.MINOR.PATCH` versions.
