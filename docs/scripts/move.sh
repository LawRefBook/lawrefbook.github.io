#!/bin/bash

# Set folder paths
SOURCE_DIR="__cache__/out/行政法规"
DEST_DIR="../行政法规"

# Ensure both directories exist
if [[ ! -d "$SOURCE_DIR" || ! -d "$DEST_DIR" ]]; then
  echo "One or both directories do not exist."
  exit 1
fi

# Loop through files in SOURCE_DIR
for file in "$SOURCE_DIR"/*; do
  if [[ -f "$file" ]]; then
    filename=$(basename "$file")
    if [[ ! -e "$DEST_DIR/$filename" ]]; then
      mv "$file" "$DEST_DIR/"
      echo "Moved: $filename"
    else
      echo "Skipped (already exists): $filename"
    fi
  fi
done
