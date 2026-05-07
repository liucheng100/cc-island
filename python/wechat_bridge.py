"""
CC Island - WeChat Bridge
基于 wxauto 的微信消息桥接服务

功能:
1. 自动登录微信PC客户端
2. 监听微信消息,转发到 Claude 会话
3. 将 Claude 回复发送回微信
4. 通过标准输入/输出与 Electron 主进程通信
"""

import sys
import json
import time
import threading
import argparse
import logging

logging.basicConfig(level=logging.INFO, format='[WX-Bridge] %(message)s')
logger = logging.getLogger(__name__)

# Try to import wxauto
try:
    from wxauto import WeChat
    WXAUTO_AVAILABLE = True
except ImportError:
    WXAUTO_AVAILABLE = False
    logger.warning("wxauto not installed. Run: pip install wxauto")
    logger.warning("Running in STUB mode - WeChat integration simulated")

# Try to import Flask for HTTP API
try:
    from flask import Flask, request, jsonify
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False


class WechatBridge:
    """微信桥接管理器"""

    def __init__(self, port=18990):
        self.port = port
        self.wx = None
        self.connected = False
        self.current_user = None
        self.session_links = {}  # wechat_id -> session_id mapping
        self.message_queue = []
        self.running = False

    def start(self):
        """启动微信桥接"""
        self.running = True

        if WXAUTO_AVAILABLE:
            self._connect_wechat()
        else:
            self._stub_mode()

    def _connect_wechat(self):
        """连接到微信PC客户端"""
        try:
            logger.info("正在连接微信PC客户端...")
            self.wx = WeChat()

            # Try to get logged-in user
            try:
                self.current_user = self.wx.GetSelfInfo().get('nickname', 'Unknown')
            except Exception:
                self.current_user = "WeChat User"

            self.connected = True
            logger.info(f"LOGIN_SUCCESS")
            logger.info(f"USER:{self.current_user}")
            print("LOGIN_SUCCESS", flush=True)
            print(f"USER:{self.current_user}", flush=True)

            # Start message listener
            self._start_listener()

        except Exception as e:
            logger.error(f"连接微信失败: {e}")
            logger.info("请确保微信PC客户端已登录并打开")
            print("QR_READY", flush=True)

    def _stub_mode(self):
        """模拟模式 - 用于测试"""
        logger.info("STUB 模式启动 - 模拟微信连接")
        self.current_user = "TestUser"
        self.connected = True
        print("LOGIN_SUCCESS", flush=True)
        print("USER:TestUser", flush=True)

        # Simulate message receiving in stub mode
        def stub_messages():
            while self.running:
                time.sleep(5)
                # Simulate receiving a message
                if self.session_links:
                    for wx_id, session_id in list(self.session_links.items())[:1]:
                        self._handle_incoming_message(
                            wx_id, "帮我检查一下代码", session_id
                        )

        threading.Thread(target=stub_messages, daemon=True).start()

    def _start_listener(self):
        """启动微信消息监听"""
        def listen():
            logger.info("开始监听微信消息...")
            last_messages = set()

            while self.running and self.connected:
                try:
                    # Get new messages from all chats
                    if hasattr(self.wx, 'GetAllNewMessage'):
                        new_msgs = self.wx.GetAllNewMessage()
                    else:
                        # Fallback: check specific chats
                        new_msgs = self.wx.GetLastMessage() or []

                    if new_msgs:
                        for msg in new_msgs:
                            msg_id = str(msg.get('msgid', ''))
                            if msg_id and msg_id not in last_messages:
                                last_messages.add(msg_id)
                                sender = msg.get('sender', '')
                                content = msg.get('content', '')
                                self._handle_incoming_message(sender, content)

                                # Keep set bounded
                                if len(last_messages) > 1000:
                                    last_messages = set(list(last_messages)[-500:])

                    time.sleep(1)
                except Exception as e:
                    logger.error(f"消息监听错误: {e}")
                    time.sleep(5)

        threading.Thread(target=listen, daemon=True).start()

    def _handle_incoming_message(self, sender, content, session_id=None):
        """处理收到的微信消息"""
        logger.info(f"[消息] {sender}: {content}")

        # Check if sender is linked to a session
        if sender in self.session_links:
            session_id = self.session_links[sender]

        if session_id:
            # Forward to Claude session via Electron IPC
            msg = {
                "type": "wechat_message",
                "sender": sender,
                "content": content,
                "session_id": session_id,
            }
            print(f"MESSAGE:{json.dumps(msg, ensure_ascii=False)}", flush=True)
            self.message_queue.append(msg)

    def send_message(self, to_user, content):
        """发送微信消息"""
        if not self.connected:
            logger.error("微信未连接")
            return False

        try:
            if WXAUTO_AVAILABLE and self.wx:
                # Send via wxauto
                self.wx.SendMessage(to_user, content)
            else:
                # Stub mode - just log
                logger.info(f"[STUB 发送] To: {to_user}: {content}")

            logger.info(f"已发送消息给 {to_user}")
            return True

        except Exception as e:
            logger.error(f"发送消息失败: {e}")
            return False

    def link_session(self, wechat_id, session_id):
        """将微信用户关联到 Claude 会话"""
        self.session_links[wechat_id] = session_id
        logger.info(f"已关联: {wechat_id} -> {session_id}")

    def unlink_session(self, wechat_id):
        """取消关联"""
        if wechat_id in self.session_links:
            del self.session_links[wechat_id]
            logger.info(f"已取消关联: {wechat_id}")

    def get_status(self):
        """获取当前状态"""
        return {
            "connected": self.connected,
            "user": self.current_user,
            "linked_sessions": len(self.session_links),
            "stub_mode": not WXAUTO_AVAILABLE,
        }

    def stop(self):
        """停止桥接"""
        self.running = False
        self.connected = False
        logger.info("微信桥接已停止")


def create_flask_app(bridge):
    """创建 Flask HTTP API"""
    app = Flask(__name__)

    @app.route('/status', methods=['GET'])
    def status():
        return jsonify(bridge.get_status())

    @app.route('/send', methods=['POST'])
    def send():
        data = request.get_json()
        to_user = data.get('to', bridge.current_user)
        content = data.get('content', '')
        success = bridge.send_message(to_user, content)
        return jsonify({"success": success})

    @app.route('/link', methods=['POST'])
    def link():
        data = request.get_json()
        bridge.link_session(
            data.get('wechat_id', ''),
            data.get('session_id', '')
        )
        return jsonify({"success": True})

    @app.route('/unlink', methods=['POST'])
    def unlink():
        data = request.get_json()
        bridge.unlink_session(data.get('wechat_id', ''))
        return jsonify({"success": True})

    return app


def main():
    parser = argparse.ArgumentParser(description='CC Island WeChat Bridge')
    parser.add_argument('--port', type=int, default=18990, help='HTTP API port')
    parser.add_argument('--no-server', action='store_true', help='Run without HTTP server')
    args = parser.parse_args()

    bridge = WechatBridge(port=args.port)
    bridge.start()

    if args.no_server:
        # Just run the bridge, communicate via stdin/stdout
        logger.info("桥接已启动, 通过 stdin/stdout 通信")
        try:
            while bridge.running:
                line = sys.stdin.readline()
                if not line:
                    break
                try:
                    cmd = json.loads(line.strip())
                    action = cmd.get('action', '')
                    if action == 'send':
                        bridge.send_message(
                            cmd.get('to', bridge.current_user),
                            cmd.get('content', '')
                        )
                    elif action == 'link':
                        bridge.link_session(
                            cmd.get('wechat_id', ''),
                            cmd.get('session_id', '')
                        )
                    elif action == 'unlink':
                        bridge.unlink_session(cmd.get('wechat_id', ''))
                    elif action == 'status':
                        print(json.dumps(bridge.get_status()), flush=True)
                    elif action == 'stop':
                        bridge.stop()
                        break
                except json.JSONDecodeError:
                    logger.error(f"无效命令: {line}")
        except KeyboardInterrupt:
            pass
    else:
        # Run with HTTP API server
        if FLASK_AVAILABLE:
            app = create_flask_app(bridge)
            logger.info(f"HTTP API 服务启动在端口 {args.port}")
            print(f"SERVER_READY:{args.port}", flush=True)
            app.run(host='127.0.0.1', port=args.port, debug=False, use_reloader=False)
        else:
            logger.error("Flask not installed. Run: pip install flask")
            logger.info("Falling back to stdin/stdout mode")
            try:
                while bridge.running:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass

    bridge.stop()


if __name__ == '__main__':
    main()
