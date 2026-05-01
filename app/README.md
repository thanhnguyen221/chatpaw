# 🐾 PawTalk - Real-Time Social Network & Messaging Platform

![Flask](https://img.shields.io/badge/-Flask-000000?style=for-the-badge&logo=flask&logoColor=white)
![MongoDB](https://img.shields.io/badge/-MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![WebSocket](https://img.shields.io/badge/-WebSocket-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![WebRTC](https://img.shields.io/badge/-WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white)
![Google Gemini](https://img.shields.io/badge/-Gemini%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white)

A full-stack social networking platform that combines **Facebook-style social features** with **Messenger-style real-time messaging**. Built with Flask and MongoDB, featuring end-to-end encrypted chat, WebRTC video/voice calls, AI-powered translation, and comprehensive media sharing capabilities.

## 📺 Video Demo
Experience the real-time chat and video calling features in action:

> [!TIP]
> **Coming Soon** - Demo video showcasing real-time messaging, video calls, and AI translation features.

---

## ✨ Key Features

* **Real-Time Messaging System:** WebSocket-powered chat with 1-on-1 and group conversations, featuring end-to-end encryption, read receipts, typing indicators, and online/offline status tracking.
* **WebRTC Video & Voice Calling:** Peer-to-peer video and voice calls with screen sharing support, using SocketIO for signaling and STUN/TURN servers for NAT traversal.
* **AI-Powered Chat Assistant:** Google Gemini AI integration for automatic chat summarization and real-time multilingual translation with automatic language detection.
* **Social Networking Suite:** Complete social features including user profiles, posts, stories (24h expiration), comments, likes, friend requests, and real-time notifications.
* **Advanced Media Handling:** Support for 40+ file formats including images, videos, documents, code files, and archives. Cloudinary integration for cloud storage with automatic image optimization.
* **Enterprise-Grade Security:** bcrypt password hashing, session fingerprinting, single-session-per-user enforcement, and end-to-end message encryption to prevent concurrent logins and ensure data privacy.

---

## ⚙️ Architecture & How It Works

**1. Real-Time Communication Layer**
The application leverages Flask-SocketIO for bidirectional event-based communication. The WebSocket layer handles:
- Message delivery with acknowledgment receipts
- Online/offline presence tracking via heartbeat mechanism
- Typing indicators and read status synchronization
- Friend request and notification broadcasting

**2. WebRTC Calling Infrastructure**
Implements the WebRTC protocol for peer-to-peer media streaming:
- **Signaling Server:** SocketIO coordinates SDP offer/answer exchange and ICE candidate negotiation
- **Connection Types:** Supports both mesh (P2P) configurations for private calls
- **Features:** Video/audio toggle, screen sharing, mute controls, and call recording metadata

**3. AI Integration Layer**
Google Gemini AI powers two core features:
- **Chat Summarization:** Condenses long conversation threads into key action items and decisions
- **Real-Time Translation:** Automatically detects message language and translates using deep-translator with Gemini context enhancement

**4. Data Persistence & Security**
- **MongoDB Schema:** Optimized collections for users, conversations, messages, groups, and social interactions
- **Message Encryption:** AES-256 encryption for message content with rotating keys per conversation
- **Session Management:** JWT-based authentication with device fingerprinting to prevent session hijacking

**5. Media Processing Pipeline**
- **Upload Handling:** Multi-part form processing with size validation (max 50MB per file)
- **Image Processing:** Pillow library for automatic resizing, format conversion, and thumbnail generation
- **Cloud Storage:** Cloudinary CDN for global media delivery with automatic format optimization

---

## 🛠 Tech Stack

| Category | Technologies |
|----------|-------------|
| **Backend** | Flask, Flask-SocketIO, Flask-PyMongo, Flask-Login |
| **Database** | MongoDB (NoSQL document storage) |
| **Real-Time** | WebSocket, WebRTC, Server-Sent Events |
| **AI & APIs** | Google Gemini API, DeepSeek-R1 API, Cloudinary API |
| **Security** | bcrypt, cryptography, python-dotenv |
| **Media** | Pillow, Cloudinary, Werkzeug |
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla), Socket.IO Client |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- MongoDB 6.0+ (local or Atlas)
- Google Gemini API Key
- Cloudinary Account (for media uploads)

### Installation

**1. Clone the repository:**
```bash
git clone https://github.com/thanhnguyen221/chatpaw.git
cd pawtalk
```

**2. Create virtual environment:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

**3. Install dependencies:**
```bash
pip install -r requirements.txt
```

**4. Configure environment variables:**
Create a `.env` file in the root directory:
```env
SECRET_KEY=your_secret_key_here
MONGO_URI=mongodb://localhost:27017/pawtalk
GEMINI_API_KEY=your_gemini_api_key_here
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

**5. Initialize MongoDB:**
Ensure MongoDB is running on your system, then:
```bash
# The app will automatically create required collections on first run
```

**6. Run the application:**
```bash
python3 run.py
```

**7. Access the platform:**
Open your browser and navigate to:
```
http://localhost:5001
```

---

## 📱 Core Features Walkthrough

### 💬 Real-Time Chat
- Instant message delivery with WebSocket
- Message encryption for privacy
- Typing indicators and read receipts
- Group chat with admin controls
- Message search and history

### 📹 Video & Voice Calls
- 1-on-1 private calls
- Group video conferences
- Screen sharing capability
- Call recording metadata
- Mute/unmute controls

### 🔗 AI-Powered Features
- **Smart Summarize:** Condense long chats into summaries
- **Auto-Translate:** Real-time message translation with language detection
- **Context Awareness:** AI understands conversation context for better translations

### 👥 Social Networking
- User profiles with avatars and bios
- Post creation with media attachments
- Stories with 24-hour auto-expiration
- Like, comment, and share functionality
- Friend requests and management
- Real-time notifications feed

### 📁 File Sharing
- Support for images, videos, documents
- Code file sharing with syntax highlighting
- Archive upload and extraction (ZIP)
- Automatic image compression and optimization

---

## 📊 Project Structure

```
pawtalk/
├── app/
│   ├── __init__.py          # Flask app initialization
│   ├── auth.py              # Authentication & security
│   ├── routes.py            # Main application routes
│   ├── events/              # WebSocket event handlers
│   │   ├── chat.py           # Chat messaging events
│   │   ├── call.py           # WebRTC calling events
│   │   ├── friend.py         # Friend system events
│   │   ├── group.py          # Group chat events
│   │   └── comment.py        # Post comment events
│   ├── models.py            # Database models
│   ├── message_encryption.py # E2E encryption logic
│   ├── cloudinary_storage.py # Media upload handling
│   └── utils/               # Utility functions
├── static/                # CSS, JS, images
├── templates/             # HTML templates
├── requirements.txt       # Python dependencies
├── run.py                 # Application entry point
└── README.md              # This file
```

---

## 🔐 Security Features

- **Password Security:** bcrypt hashing with salt rounds
- **Session Security:** Device fingerprinting and IP tracking
- **Single Session:** One active login per user account
- **Message Encryption:** AES-256 for message content
- **Input Validation:** XSS and injection attack prevention
- **CSRF Protection:** Cross-site request forgery prevention

---

## 🦾 Research Context

This project was developed as part of **Scientific Research at Kien Giang University (NCKH 10:3)**, exploring:
- Real-time communication protocols in web applications
- WebRTC implementation for browser-based video calling
- AI integration for natural language processing in chat applications
- NoSQL database design for social media applications

---

## 📄 License

This project is licensed under the MIT License.

---



## 👨‍💻 Authors

**Trần Thanh Thuy**
- **Role:** Project Leader / Research Lead
- **Responsibilities:** Social Networking Architecture, Timeline Features & System Design.
- **GitHub:** [@Thuy-art](https://github.com/Thuy-art)

**Thanh Nguyen-Nhut**
- **Role:** Technical Lead / Backend Developer
- **Responsibilities:** Real-time Communication (WebSocket/WebRTC), AI Integration & Security Workflow.
- **GitHub:** [@thanhnguyen221](https://github.com/thanhnguyen221)
- **LinkedIn:** [Thanh Nguyen](https://linkedin.com/in/nhut-thanh-nguyen-6041343b2)
- **Email:** thanhfff55@gmail.com
---

<p align="center">
  Made with ❤️ and ☕ | PawTalk 🐾
</p>
