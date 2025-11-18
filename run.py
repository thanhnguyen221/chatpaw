from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
      app.config['UPLOAD_FOLDER'] = 'app/static/uploads'
      socketio.run(app, host="0.0.0.0", port=5001, debug=True)
