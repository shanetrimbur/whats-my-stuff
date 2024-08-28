#!/bin/bash

# Initialize the SQLite database
sqlite3 ../database/database.db < ../database/init.sql

echo "Setup complete! Database initialized."
