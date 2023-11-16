require('dotenv').config();

const { S3Client, ListObjectsCommand, CopyObjectCommand, DeleteObjectCommand, PutObjectAclCommand } = require("@aws-sdk/client-s3");
const fetch = require('node-fetch');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const moment = require('moment-timezone');
const fs = require('fs');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
});

const listParams = { Bucket: process.env.AWS_BUCKETS };


const getMetaDataFile = async (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                /*  
                    - 1. Lấy thời gian sáng tạo từ metadata
                    - 2. Chuyển đổi thời gian sang múi giờ GMT
                    - 3. Chuyển đổi từ GMT sang múi giờ của Việt Nam
                    - 4. Lấy độ dài của video (thời lượng tính bằng giây)
                    - 5. Chuyển đổi độ dài từ giây sang phút
                    - 6. Tạo tên file mới

                */
                const creationTime = metadata.format.tags.creation_time;
                const gmtTime = moment.utc(creationTime).format();
                const vnTime = moment(gmtTime).tz('Asia/Ho_Chi_Minh').format('H-mm-ss_D-M-YYYY');
                const folderName = moment(gmtTime).tz('Asia/Ho_Chi_Minh').format('D-M-YYYY');
                const videoDurationInSeconds = metadata.format.duration;
                const videoDurationInMinutes = Math.floor(videoDurationInSeconds / 60);

                const fileInfo = {
                    folderName: folderName,
                    fileName: `${vnTime}.mp4`,
                    videoDuration: videoDurationInMinutes
                };


                resolve(fileInfo);
            }
        });
    });
}

function logAdd(message) {
    const currentTime = moment().format('H:mm:ss D-M-YYYY');
    const logMessage = `${currentTime}\n${message}\n`;

    const logFileName = moment().format('DD-MM-YYYY') + '.txt';
    const logFilePath = `./logs/${logFileName}`;
    if (fs.existsSync(logFilePath)) {
        fs.appendFileSync(logFilePath, logMessage);
    } else {
        fs.writeFileSync(logFilePath, logMessage);
    }
    console.log(`Ghi thông báo vào file ${logFilePath}`);
}


async function postData(apiUrl, data) {
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: data,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error during POST request:', error.message);
        throw error;
    }
}



(async () => {
    try {
        const data = await s3Client.send(new ListObjectsCommand(listParams));
        const files = data.Contents.filter(file => file.Key.endsWith('.mp4') && !file.Key.startsWith('ADMIN_RESULT/'));


        for (const file of files) {
            const params = {
                Bucket: listParams.Bucket,
                Key: file.Key,
                ACL: 'public-read' // Đặt quyền public
            };

            const putAclData = await s3Client.send(new PutObjectAclCommand(params));
            let filePath = `https://s3.ap-southeast-1.amazonaws.com/${listParams.Bucket}/${file.Key.replace(/ /g, "%20")}`;
            let metaData = await getMetaDataFile(filePath);
            let fileName = metaData.fileName;
            let folderName = metaData.folderName;

            // Sử dụng hàm để gửi yêu cầu POST với các tham số cần thiết
            const apiUrl = 'https://e-space.vn/api/web/index.php/aws-s3-api/get-class-student';  // Thay thế bằng URL thực tế của API
            const postDataParams = new FormData();
            postDataParams.append('teacher_name', file.Key.split('/')[0].trim());
            postDataParams.append('start_date', fileName.replace(".mp4", "").trim());

            const responseData = await postData(apiUrl, postDataParams);
            if (responseData.error == 0) {
                const fileNameSave = `${responseData.data.start_date.replace(/:/g, "-").replace(" ", "_").trim()}.mp4`;
                const folderPath = `ADMIN_RESULT/${responseData.data.folderName}/${folderName}/${fileNameSave}`;

                const copyParams = {
                    Bucket: listParams.Bucket,
                    CopySource: `${listParams.Bucket}/${file.Key}`,
                    Key: folderPath,
                    ACL: 'public-read' // Đặt quyền public
                };
                await s3Client.send(new CopyObjectCommand(copyParams));

                // Xóa file từ thư mục gốc sau khi đã di chuyển
                const deleteParams = {
                    Bucket: listParams.Bucket,
                    Key: file.Key
                };
                await s3Client.send(new DeleteObjectCommand(deleteParams));


                let message = `Change file ${file.Key} to ${fileName} with public\nData: ${JSON.stringify(responseData, null, 2)}\n==========================`;
                logAdd(message);
            } else {
                let message = `Error\nData: ${JSON.stringify(responseData, null, 2)}\n==========================`;
                logAdd(message);
            }
        }
    } catch (err) {
        console.error("Lỗi khi thực hiện thao tác:", err);
    }
})();
