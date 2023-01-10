import os
import json
import logging

def handle():

    log_level = os.getenv('LOG_LEVEL', default=logging.INFO)
    logging.info(f'Log-level read from sysenv: {log_level}')

    return {
        'body': json.dumps({'message': 'SUCCESS 🎉'}),
        'statusCode': 200,
    }

