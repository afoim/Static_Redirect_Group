
export default {
  async fetch(request, env) {
    // 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 只允许 POST 请求
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // CSRF 保护: 检查 Origin/Referer
    const origin = request.headers.get("Origin");
    const referer = request.headers.get("Referer");
    const baseDomain = env.BASE_DOMAIN; // 必须配置 BASE_DOMAIN 才能启用此检查

    if (baseDomain) {
        // 允许 localhost 用于调试
        const isLocalhost = origin && (origin.includes("localhost") || origin.includes("127.0.0.1"));
        
        if (!isLocalhost) {
            let valid = false;
            // 检查 Origin
            if (origin && origin.includes(baseDomain)) {
                valid = true;
            }
            // 如果没有 Origin (某些浏览器/场景)，检查 Referer
            else if (!origin && referer && referer.includes(baseDomain)) {
                valid = true;
            }

            if (!valid) {
                 return Response.json({ error: "CSRF check failed: Invalid Origin/Referer" }, { 
                    status: 403,
                    headers: { "Access-Control-Allow-Origin": "*" }
                });
            }
        }
    }

    try {
      let pathname, url, expired_at;
      try {
        const body = await request.json();
        pathname = body.pathname;
        url = body.url;
        expired_at = body.expired_at;
      } catch (e) {
        return Response.json({ error: "Invalid JSON body" }, { 
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 1. 验证输入
      if (!pathname || typeof pathname !== "string" || pathname.length < 5 || pathname.length > 10) {
        return Response.json({ error: "Invalid pathname (5-10 chars)" }, { 
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
      // 简单正则验证 pathname 是否只包含允许字符
      if (!/^[a-zA-Z0-9_-]+$/.test(pathname)) {
        return Response.json({ error: "Invalid characters in pathname" }, { 
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      if (!url || typeof url !== "string" || url.length > 300) {
        return Response.json({ error: "Invalid URL (max 300 chars)" }, { 
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
      try {
        const parsedUrl = new URL(url); // 验证 URL 格式
        // 安全检查: 必须是 http 或 https 协议
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            return Response.json({ error: "Invalid URL protocol (only http/https allowed)" }, { 
                status: 400,
                headers: { "Access-Control-Allow-Origin": "*" }
            });
        }

        // 严格字符检查: 禁止 Emoji 和非打印字符 (只允许 ASCII 可打印字符)
        // 范围: 0x21-0x7E (标准 ASCII 符号、数字、字母)
        // 但 URL 可能包含百分号编码，所以我们检查是否包含非 ASCII 字符
        // eslint-disable-next-line no-control-regex
        if (/[^\x00-\x7F]/.test(url)) {
             return Response.json({ error: "URL contains non-ASCII characters (Emoji/Unicode not allowed)" }, { 
                status: 400,
                headers: { "Access-Control-Allow-Origin": "*" }
            });
        }

        // 检查是否指向自身 (循环重定向保护)
        const baseDomain = env.BASE_DOMAIN || "";
        if (baseDomain) {
            // 忽略大小写比较
            if (parsedUrl.hostname.toLowerCase() === baseDomain.toLowerCase()) {
                return Response.json({ error: "Cannot redirect to the URL shortener itself (Loop protection)" }, { 
                    status: 400,
                    headers: { "Access-Control-Allow-Origin": "*" }
                });
            }
        }
      } catch (e) {
        return Response.json({ error: "Invalid URL format" }, { 
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 验证 URL 安全性 (通过 Cloudflare Family DNS)
      // 我们通过 DoH (DNS over HTTPS) 查询域名
      // 如果域名被 Cloudflare Family DNS (1.1.1.3) 拦截（通常解析为 0.0.0.0 或 ::），则说明是不安全/成人内容
      try {
          const hostname = parsedUrl.hostname;
          // 排除 IP 地址 (简单的正则，非严谨)
          const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
          
          if (!isIp) {
              const dohUrl = `https://family.cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}`;
              const dohResp = await fetch(dohUrl, {
                  headers: { "Accept": "application/dns-json" }
              });
              
              if (dohResp.ok) {
                  const dnsData = await dohResp.json();
                  // 检查 Answer
                  if (dnsData.Answer) {
                      for (const answer of dnsData.Answer) {
                          // Cloudflare Family DNS 拦截的域名通常解析到 0.0.0.0 或 ::
                          if (answer.data === "0.0.0.0" || answer.data === "::") {
                              return Response.json({ error: "URL blocked by Cloudflare Family DNS (Malware/Adult Content)" }, { 
                                  status: 400,
                                  headers: { "Access-Control-Allow-Origin": "*" }
                              });
                          }
                      }
                  } else {
                      // 如果没有 Answer (NXDOMAIN 等)，可能域名不存在
                      // 但 DoH 有时对 CNAME 处理不同，这里我们主要关注拦截
                      // 如果用户输入了不存在的域名，虽然不能访问，但不算安全风险
                  }
              }
          }
      } catch (e) {
          console.error("DNS Safety Check Error:", e);
          // 如果 DNS 检查失败，暂时放行，或者选择拒绝 (取决于安全策略)
          // 这里选择放行，避免因 DoH 服务抖动影响业务
      }

      if (!expired_at || typeof expired_at !== "number") {
        return Response.json({ error: "Invalid expiration timestamp" }, { 
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 2. 准备数据
      // 将 Unix 时间戳转换为 ISO 8601 字符串
      const expiredDate = new Date(expired_at * 1000);
      const now = new Date();
      if (isNaN(expiredDate.getTime())) {
         return Response.json({ error: "Invalid timestamp" }, { 
             status: 400,
             headers: { "Access-Control-Allow-Origin": "*" }
         });
      }

      // 检查有效期是否超过 7 天
      const diffTime = expiredDate.getTime() - now.getTime();
      const diffDays = diffTime / (1000 * 3600 * 24);
      if (diffDays > 7) {
          return Response.json({ error: "Expiration date cannot exceed 7 days from now" }, { 
              status: 400,
              headers: { "Access-Control-Allow-Origin": "*" }
          });
      }
      // 检查有效期是否在过去
      if (diffTime <= 0) {
          return Response.json({ error: "Expiration date must be in the future" }, { 
              status: 400,
              headers: { "Access-Control-Allow-Origin": "*" }
          });
      }

      const expiredAtISO = expiredDate.toISOString();

      // 3. 获取 GitHub 文件
      const owner = env.GITHUB_OWNER; // 需要在 Worker 环境变量中设置
      const repo = env.GITHUB_REPO;   // 需要在 Worker 环境变量中设置
      const branch = env.GITHUB_BRANCH || "main";
      const filePath = "js/rules_intermediate.js";
      const token = env.GITHUB_TOKEN;

      if (!token || !owner || !repo) {
        return Response.json({ error: "Server configuration error" }, { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
      
      const getResp = await fetch(getUrl, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Cloudflare-Worker",
          "Accept": "application/vnd.github.v3+json"
        }
      });

      if (!getResp.ok) {
        const errText = await getResp.text();
        console.error("GitHub Fetch Error:", errText);
        return Response.json({ error: "Failed to fetch file from GitHub: " + getResp.status }, { 
            status: 502,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      const fileData = await getResp.json();
      
      // 4. 解析并更新内容
      // 正确处理 UTF-8 解码: Base64 -> Uint8Array -> String
      const binaryString = atob(fileData.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const content = new TextDecoder('utf-8').decode(bytes);
      const sha = fileData.sha;

      // 提取 JSON 部分: window.RULES_INTERMEDIATE = {...};
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        return Response.json({ error: "Failed to parse file content" }, { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      const jsonStr = content.substring(jsonStart, jsonEnd + 1);
      let rules;
      try {
        // 使用 Function 而不是 eval 来解析 JS 对象字面量 (如果它是标准 JSON 最好，但如果是 JS 对象可能包含无引号键)
        // 既然我们生成的文件是 JSON.stringify 出来的，它应该是标准 JSON。
        rules = JSON.parse(jsonStr);
      } catch (e) {
        // 如果 JSON.parse 失败，尝试更宽松的解析或报错
        return Response.json({ error: "File content is not valid JSON" }, { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 检查是否已存在
      const pathKey = "/" + pathname;
      if (rules[pathKey]) {
        return Response.json({ error: "Pathname already exists" }, { 
            status: 409,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 添加新规则
      rules[pathKey] = {
        url: url,
        expired_at: expiredAtISO
      };

      // 5. 序列化并提交
      const newJsonStr = JSON.stringify(rules, null, 4);
      const newContent = `window.RULES_INTERMEDIATE = ${newJsonStr};\n`;
      
      // 正确处理 UTF-8 编码: String -> Uint8Array -> Base64
      const encoder = new TextEncoder();
      const data = encoder.encode(newContent);
      let binary = '';
      const len = data.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(data[i]);
      }
      const finalBase64 = btoa(binary);

      const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
      const commitMessage = `Add short link: ${pathname}`;

      const putResp = await fetch(putUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Cloudflare-Worker",
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: commitMessage,
          content: finalBase64,
          sha: sha,
          branch: branch
        })
      });

      if (!putResp.ok) {
        const errText = await putResp.text();
        console.error("GitHub API Error:", errText);
        return Response.json({ error: "Failed to commit to GitHub" }, { 
            status: 502,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 构建返回的短链 URL
      const baseDomain = env.BASE_DOMAIN || ""; 
      const shortUrl = baseDomain 
        ? `https://${baseDomain}/${pathname}` 
        : null; // 如果后端没配，前端自己拼

      const putRespData = await putResp.json();

      // 返回 Commit URL 方便前端跳转
      // 优先使用 commit.sha，如果没有则使用 content.sha，最后回退到 main
      // GitHub API Response Structure for PUT /contents/:
      // { "content": { "name": "...", "sha": "BLOB_SHA" }, "commit": { "sha": "COMMIT_SHA", ... } }
      const commitSha = putRespData.commit ? putRespData.commit.sha : (putRespData.content ? putRespData.content.sha : "main");
      const commitUrl = `https://github.com/${owner}/${repo}/commit/${commitSha}`;

      return Response.json({ 
        success: true, 
        message: "Short link created",
        short_url: shortUrl,
        commit_url: commitUrl
      }, {
        headers: { "Access-Control-Allow-Origin": "*" }
      });

    } catch (err) {
      console.error(err);
      return Response.json({ error: "Internal Server Error: " + err.message }, { 
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
