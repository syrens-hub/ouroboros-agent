#!/usr/bin/env node
/**
 * Web Agent Skill
 * 网页浏览与内容获取工具
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

// 简单的 HTTP 请求函数
function fetchUrl(url: string, options: { headers?: Record<string, string> } = {}): Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; content: string; url: string }> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            ...options.headers
        };
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers,
            timeout: 15000,
        };
        
        const req = lib.request(reqOptions, (res: http.IncomingMessage) => {
            let data = '';

            res.on('data', (chunk: string | Buffer) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    content: data,
                    url: url
                });
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// 提取网页标题
function extractTitle(html: string) {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : '';
}

// 提取 meta 描述
function extractDescription(html: string) {
    const patterns = [
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return match[1].trim();
    }
    return '';
}

// 提取所有中文文本
function extractChineseText(html: string) {
    // 移除 script 和 style
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\s+/g, ' ');
    
    // 提取中文片段
    const chinese = text.match(/[\u4e00-\u9fff]{2,}/g);
    if (chinese) {
        // 去重并限制数量
        const unique = [...new Set(chinese)];
        return unique.slice(0, 200).join(' ');
    }
    return '';
}

// 主函数
async function main() {
    const url = process.argv[2] || 'https://example.com';
    
    console.log(`正在访问: ${url}`);
    
    try {
        const result = await fetchUrl(url);
        
        if (result.status !== 200) {
            console.log(`HTTP ${result.status}`);
            process.exit(1);
        }
        
        const title = extractTitle(result.content);
        const description = extractDescription(result.content);
        const chineseText = extractChineseText(result.content);
        
        console.log('='.repeat(60));
        console.log(`📄 ${title || '无标题'}`);
        console.log('='.repeat(60));
        
        if (description) {
            console.log(`\n📝 描述: ${description}`);
        }
        
        console.log(`\n🔗 链接数: ${(result.content.match(/<a /g) || []).length}`);
        console.log(`🖼️ 图片数: ${(result.content.match(/<img /g) || []).length}`);
        console.log(`📊 内容长度: ${result.content.length} 字符`);
        
        if (chineseText && chineseText.length > 20) {
            console.log(`\n📄 提取的中文内容:`);
            console.log('-'.repeat(40));
            console.log(chineseText.substring(0, 2000));
        } else {
            console.log('\n⚠️ 未提取到有效中文内容（可能是反爬虫保护或非中文页面）');
        }
        
    } catch (error: unknown) {
        console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

main();
