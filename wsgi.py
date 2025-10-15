import eventlet
eventlet.monkey_patch()  # patch before any other imports

from app import app  # gunicorn loads wsgi:app
