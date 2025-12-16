// ===== MAINTENANCE MODE =====
const MAINTENANCE = true;
const MAINTENANCE_MESSAGE = `
Привет! 👋<br><br>
С <b>15:00 до 16:00</b> у нас плановые технические работы, поэтому загрузить решение временно не получится.<br><br>
Мы ждём твой результат после <b>16:00</b>!
`;

// ================== КОНФИГ ==================
const BASE_URL = "https://ndb.fut.ru";
const TABLE_ID = "m6tyxd3346dlhco";
const API_KEY = "N0eYiucuiiwSGIvPK5uIcOasZc_nJy6mBUihgaYQ";

const RECORDS_ENDPOINT = `${BASE_URL}/api/v2/tables/${TABLE_ID}/records`;
const FILE_UPLOAD_ENDPOINT = `${BASE_URL}/api/v2/storage/upload`;

// поле для файла (решение/ТЗ — как у тебя в базе)
const RESUME_FIELD_ID = "crizvpe2wzh0s98";

let currentRecordId = null;
let userPlatform = null;
let rawUserId = null;

const screens = {
    upload: document.getElementById("uploadScreen"),
    result: document.getElementById("resultScreen")
};

// ================== UI ==================

function showScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    if (screens[name]) {
        screens[name].classList.remove("hidden");
    }
}

function showInlineError(msg) {
    const error = document.getElementById("error");
    if (!error) return;
    error.textContent = msg;
    error.classList.remove("hidden");
}

function clearInlineError() {
    const error = document.getElementById("error");
    if (!error) return;
    error.textContent = "";
    error.classList.add("hidden");
}

function showMaintenance() {
    document.body.innerHTML = `
        <div style="
            background:#20232a;
            color:#fff;
            min-height:100vh;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:40px 20px;
            box-sizing:border-box;
            font-family: Ubuntu, sans-serif;
        ">
            <div style="max-width:520px;">
                <h2>Технические работы</h2>
                <p style="font-size:18px;line-height:1.5;margin-top:20px;">
                    ${MAINTENANCE_MESSAGE}
                </p>
            </div>
        </div>
    `;
}

// ================== API ==================

// Поиск пользователя по tg-id (с поддержкой _VK)
async function findUser(id) {
    // Telegram ID как есть
    let res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${id})`, {
        headers: { "xc-token": API_KEY }
    });
    let data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "tg" };
    }

    // VK ID c суффиксом _VK
    const vkValue = id + "_VK";
    res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${vkValue})`, {
        headers: { "xc-token": API_KEY }
    });
    data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "vk" };
    }

    return null;
}

// Загрузка файла в хранилище и запись в таблицу
async function uploadResume(recordId, file) {
    if (!recordId) {
        throw new Error("Техническая ошибка: не найдена запись пользователя в базе.");
    }

    const form = new FormData();
    form.append("file", file);
    form.append("path", "resumes");

    const upload = await fetch(FILE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "xc-token": API_KEY },
        body: form
    });

    if (!upload.ok) throw new Error("Ошибка загрузки файла на сервер.");

    const info = await upload.json();
    const fileData = Array.isArray(info) ? info[0] : info;
    const url = fileData.url || `${BASE_URL}/${fileData.path}`;

    const attachment = [{
        title: fileData.title || file.name,
        mimetype: file.type || fileData.mimetype,
        size: file.size,
        url: url
    }];

    const body = {
        Id: Number(recordId),
        [RESUME_FIELD_ID]: attachment
    };

    const patch = await fetch(RECORDS_ENDPOINT, {
        method: "PATCH",
        headers: {
            "xc-token": API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!patch.ok) {
        const errText = await patch.text();
        console.error("PATCH error:", errText);
        throw new Error("Не удалось сохранить файл в базу.");
    }
}

// Фейковый прогресс
async function fakeProgress() {
    const bar = document.getElementById("progress");
    const status = document.getElementById("status");
    let p = 0;

    return new Promise(resolve => {
        const int = setInterval(() => {
            p += 12 + Math.random() * 20;
            if (p >= 100) {
                p = 100;
                clearInterval(int);
                status.textContent = "Готово!";
                resolve();
            }
            bar.style.width = p + "%";
            status.textContent = `Загрузка ${Math.round(p)}%`;
        }, 120);
    });
}

// ================== СТАРТ ==================

(async () => {
    try {
        // 0) Maintenance
        if (MAINTENANCE) {
            showMaintenance();
            return;
        }

        // 1) Сразу показываем UI
        showScreen("upload");

        // 2) Определяем платформу: сначала Telegram, потом VK
        if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            const tg = window.Telegram.WebApp;
            try {
                tg.ready();
                tg.expand();
            } catch (e) {
                console.log("Telegram ready/expand error:", e);
            }
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            console.log("Telegram пользователь:", rawUserId);
        } else if (window.vkBridge) {
            try {
                await window.vkBridge.send("VKWebAppInit");
                const userInfo = await window.vkBridge.send("VKWebAppGetUserInfo");
                if (userInfo && userInfo.id) {
                    rawUserId = userInfo.id;
                    userPlatform = "vk";
                    console.log("VK пользователь:", rawUserId);
                }
            } catch (vkErr) {
                console.log("VK Bridge error:", vkErr);
            }
        }

        if (!rawUserId) {
            showInlineError("Не удалось определить пользователя. Откройте приложение из Telegram-бота или VK Mini Apps.");
            return;
        }

        // 3) Ищем пользователя в базе
        const user = await findUser(rawUserId);
        if (!user) {
            showInlineError("Вы не зарегистрированы. Напишите в бот, чтобы привязать аккаунт.");
            const btn = document.getElementById("submitFile");
            if (btn) btn.disabled = true;
            return;
        }

        currentRecordId = user.recordId;
        userPlatform = user.platform;

    } catch (err) {
        console.error(err);
        showInlineError(err.message || "Ошибка запуска");
    }
})();

// ================== ОБРАБОТЧИКИ ==================

document.getElementById("submitFile")?.addEventListener("click", async () => {
    const input = document.getElementById("fileInput");
    const file = input.files[0];

    clearInlineError();

    if (!file) return showInlineError("Выберите файл.");
    if (file.size > 15 * 1024 * 1024) return showInlineError("Файл больше 15 МБ.");

    const allowed = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/png",
        "image/jpeg"
    ];

    if (!allowed.includes(file.type)) {
        return showInlineError("Допустимы только PDF, DOC/DOCX или PNG/JPG.");
    }

    try {
        await fakeProgress();
        await uploadResume(currentRecordId, file);
        showScreen("result");
    } catch (e) {
        console.error(e);
        showInlineError(e.message || "Ошибка загрузки файла.");
    }
});

document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        window.vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    } else {
        window.close();
    }
});
