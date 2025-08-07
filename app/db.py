from pymongo import MongoClient

client = None
db = None

def init_db():
    global client, db
    client = MongoClient('mongodb://localhost:27017/')
    db = client['realtime_chat']
