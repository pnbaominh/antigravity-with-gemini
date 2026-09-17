export function renderDashboardHtml(data: {
  workspaceRoot: string;
  port: number;
  hasActivePairingCode: boolean;
  geminiConfigured: boolean;
  branch?: string;
  queryParams?: Record<string, string>;
}): string {
  const { workspaceRoot, port, geminiConfigured, branch, queryParams = {} } = data;
  const redirectUri = queryParams.redirect_uri || "";
  const clientId = queryParams.client_id || "web-client";
  const state = queryParams.state || "";
  const codeChallenge = queryParams.code_challenge || "";

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity with Gemini (G2A Bridge)</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --primary: #58a6ff;
      --primary-hover: #388bfd;
      --success: #238636;
      --success-bg: rgba(35, 134, 54, 0.15);
      --warning: #d29922;
      --warning-bg: rgba(210, 153, 34, 0.15);
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      padding: 24px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      width: 100%;
      max-width: 680px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    .header {
      padding: 24px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, #1f242c 0%, #161b22 100%);
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    h1 {
      font-size: 20px;
      color: var(--heading);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--success-bg);
      border: 1px solid var(--success);
      color: #3fb950;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3fb950;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.4; }
      100% { opacity: 1; }
    }
    .content { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
    
    .card {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--heading);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card p { font-size: 14px; margin-bottom: 16px; color: #8b949e; }
    
    .pair-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .code-input-row {
      display: flex;
      gap: 10px;
    }
    .code-input {
      flex: 1;
      background: #161b22;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #fff;
      font-size: 24px;
      font-family: var(--font-mono);
      font-weight: bold;
      letter-spacing: 6px;
      text-align: center;
      padding: 10px 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    .code-input:focus { border-color: var(--primary); }
    .btn {
      background: var(--primary);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      padding: 0 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 13px;
      display: none;
    }
    .alert-success { background: var(--success-bg); border: 1px solid var(--success); color: #3fb950; }
    .alert-error { background: rgba(248, 81, 73, 0.15); border: 1px solid #f85149; color: #ff7b72; }
    .alert-info { background: var(--warning-bg); border: 1px solid var(--warning); color: #e3b341; }

    .notice-card {
      background: rgba(56, 139, 253, 0.08);
      border: 1px solid rgba(56, 139, 253, 0.3);
    }
    .notice-card .card-title { color: var(--primary); }
    .meta-list {
      list-style: none;
      font-size: 13px;
      font-family: var(--font-mono);
      color: #8b949e;
    }
    .meta-list li {
      padding: 4px 0;
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #21262d;
    }
    .meta-list li:last-child { border-bottom: none; }
    .meta-val { color: var(--heading); font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-row">
        <h1>🚀 Antigravity with Gemini (G2A)</h1>
        <div class="status-badge">
          <div class="status-dot"></div>
          Bridge Online (Port ${port})
        </div>
      </div>
    </div>

    <div class="content">
      <!-- Pairing Code Form -->
      <div class="card">
        <div class="card-title">🔑 Nhập mã Pairing Code 6 chữ số</div>
        <p>Nếu bạn đang kết nối client OAuth bên ngoài hoặc trình duyệt, hãy nhập mã 6 số từ terminal (ví dụ: <code style="color:var(--primary); font-family:var(--font-mono); font-weight:bold;">722279</code>):</p>
        
        <form class="pair-form" id="pairForm">
          <div class="code-input-row">
            <input 
              type="text" 
              id="pairingCode" 
              class="code-input" 
              maxlength="6" 
              placeholder="000000" 
              autocomplete="off" 
              autofocus
            />
            <button type="submit" class="btn" id="submitBtn">Xác nhận</button>
          </div>
          <div id="alertSuccess" class="alert alert-success"></div>
          <div id="alertError" class="alert alert-error"></div>
        </form>
      </div>

      <!-- Antigravity Notice -->
      <div class="card notice-card">
        <div class="card-title">💡 Bạn đang dùng Antigravity?</div>
        <p style="color: var(--text); margin-bottom: 10px;">
          <strong>Bạn KHÔNG CẦN nhập mã này!</strong> Antigravity được thiết kế để kết nối trực tiếp với MCP Server qua đường truyền Stdio nội bộ (đã cấu hình sẵn trong <code>mcp_config.json</code>).
        </p>
        <p style="color: #8b949e; margin-bottom: 0;">
          Để Gemini lập kế hoạch và Antigravity thực thi, chỉ cần nhắn trong khung chat Antigravity:
          <br>
          <code style="display:block; margin-top:8px; padding:8px 12px; background:#161b22; border-radius:4px; color:#58a6ff; font-family:var(--font-mono);">
            Dùng skill antigravity-with-gemini để lên PLAN và thực hiện: [Nhiệm vụ của bạn]
          </code>
        </p>
      </div>

      <!-- Workspace Meta -->
      <div class="card">
        <div class="card-title">⚙️ Thông tin Workspace</div>
        <ul class="meta-list">
          <li><span>Workspace:</span> <span class="meta-val">${workspaceRoot}</span></li>
          <li><span>Git Branch:</span> <span class="meta-val">${branch || "main"}</span></li>
          <li><span>Gemini API Key:</span> <span class="meta-val" style="color: ${geminiConfigured ? '#3fb950' : '#d29922'};">${geminiConfigured ? '✓ Đã cấu hình' : '! Chưa cấu hình (Chạy g2a setup --api-key)'}</span></li>
          <li><span>MCP Protocol:</span> <span class="meta-val">1.0.0 (Stdio & SSE)</span></li>
        </ul>
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('pairForm');
    const input = document.getElementById('pairingCode');
    const alertSuccess = document.getElementById('alertSuccess');
    const alertError = document.getElementById('alertError');
    const submitBtn = document.getElementById('submitBtn');

    const redirectUri = ${JSON.stringify(redirectUri)};
    const clientId = ${JSON.stringify(clientId)};
    const state = ${JSON.stringify(state)};
    const codeChallenge = ${JSON.stringify(codeChallenge)};

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertSuccess.style.display = 'none';
      alertError.style.display = 'none';

      const code = input.value.trim();
      if (!code || code.length !== 6) {
        alertError.textContent = 'Vui lòng nhập đúng 6 chữ số.';
        alertError.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang kiểm tra...';

      try {
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: code,
            clientId: clientId || 'web-client',
            codeChallenge: codeChallenge || 'g2a-local-challenge',
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Mã pairing code không đúng hoặc đã hết hạn.');
        }

        alertSuccess.innerHTML = '✓ <strong>Ghép đôi thành công!</strong> Mã xác thực OAuth: <code>' + data.authCode + '</code>';
        alertSuccess.style.display = 'block';

        if (redirectUri) {
          setTimeout(() => {
            const dest = new URL(redirectUri);
            dest.searchParams.set('code', data.authCode);
            if (state) dest.searchParams.set('state', state);
            window.location.href = dest.toString();
          }, 1500);
        }
      } catch (err) {
        alertError.textContent = err.message || 'Lỗi khi xác thực.';
        alertError.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Xác nhận';
      }
    });
  </script>
</body>
</html>`;
}
