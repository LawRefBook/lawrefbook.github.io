#!/bin/bash

# Get the parent directory of the current script
parent_dir="content/docs/DLC/"

# Iterate through sibling directories
for dir in "$parent_dir"*/*; do
    # Extract the folder name from the path
    filename=$(basename "$dir")

    if [ "$filename" != "db.sqlite3" ] && [ -d "$dir" ]; then
        cp -r "$dir" "content/docs/"
    fi

done

rm -rf "$parent_dir"