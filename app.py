from flask import Flask

app = Flask(__name__)

@app.route('/')
def index():
    return 'Ammo Alert - Price tracking service'

if __name__ == '__main__':
    app.run()
