# What's My Stuff

A web-based application that helps users make best use of their stuff (random junk around the house that you might throw out) by taking pictures, tagging items using AI/ML, and crowdsourcing ideas.

## Features

- Webcam capture and item tagging
- SQLite database for item storage
- User authentication
- Marketplace for listing, trading, and transacting items
- Real-time notifications

## Setup

1. Run `bash scripts/setup.sh` from the project root to initialize the SQLite database and upload directory.
2. Start a PHP server from the project root, for example `php -S localhost:8000`.
3. Navigate to `http://localhost:8000/frontend/index.html`.

## Usage

- Capture items using a camera. Most likely a mobile device.
- View captured items and generated starter tags.
- List items in the marketplace and make trades.

## Current development focus

The core capture flow now stores uploaded images on disk and item metadata in SQLite. AI tagging,
authentication, marketplace trades, transactions, and notifications are still planned areas.
