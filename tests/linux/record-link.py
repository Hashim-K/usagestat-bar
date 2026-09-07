#!/usr/bin/env python3
"""Registered desktop URL handler for the disposable preferences acceptance test."""
import json
import os
from pathlib import Path
import sys

output = Path(os.environ['USAGESTAT_UI_OUT']) / 'opened-links.jsonl'
with output.open('a') as stream:
    stream.write(json.dumps({'uri': sys.argv[-1]}) + '\n')
