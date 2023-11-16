require('dotenv').config();
const {
    IAMClient,
    ListUsersCommand,
    CreateUserCommand,
    DeleteUserCommand,
    AttachUserPolicyCommand,
    CreateAccessKeyCommand,
    ListAttachedUserPoliciesCommand,
    DetachUserPolicyCommand,
    ListAccessKeysCommand,
    DeleteAccessKeyCommand,
} = require("@aws-sdk/client-iam");

const { S3Client, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const Buckets = process.env.AWS_BUCKETS;
const Region = process.env.AWS_REGION;
const IAMPolicy = process.env.AWS_IAM_POLICY
const Credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
}


const iamClient = new IAMClient({
    region: Region,
    credentials: Credentials
});

const s3Client = new S3Client({
    region: Region,
    credentials: Credentials
});



async function listIAMGroups() {

    try {
        const command = new ListUsersCommand({});
        const response = await iamClient.send(command);

        if (response.Users && response.Users.length > 0) {
            response.Users.forEach((user) => {
                console.log("User Name:", user.UserName);
                console.log("User ID:", user.UserId);
                console.log("Arn:", user.Arn);
                console.log("--------------------");
            });
        } else {
            console.log("Không có người dùng IAM.");
        }
    } catch (error) {
        console.error("Lỗi khi liệt kê người dùng IAM:", error);
    } finally {
        // Đảm bảo đóng kết nối
        await iamClient.destroy();
    }
}

// Hàm kiểm tra sự tồn tại của người dùng IAM
async function userExists(userName) {
    try {
        const listCommand = new ListUsersCommand({});
        const response = await iamClient.send(listCommand);
        const users = response.Users;

        return users.some(user => user.UserName === userName);
    } catch (error) {
        console.error("Lỗi khi kiểm tra sự tồn tại của người dùng IAM:", error);
        return false;
    }
}

// Hàm kiểm tra sự tồn tại của Folder
async function folderExists(folderKey) {
    try {
        const headObjectCommand = new HeadObjectCommand({
            Bucket: Buckets,
            Key: folderKey,
        });
        await s3Client.send(headObjectCommand);
        return true; // Nếu không có lỗi, folder tồn tại
    } catch (error) {
        if (error.name === "NotFound") {
            return false; // Nếu lỗi là "NotFound", folder không tồn tại
        }
        throw error; // Nếu lỗi khác, ném lỗi
    }
}
// Hàm tạo folder
async function createFolder(folderKey) {
    try {
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: Buckets,
                Key: folderKey,
                Body: "",
            },
        });

        await upload.done(); // Chờ đợi quá trình tải lên hoàn tất
        console.log(`Đã tạo thư mục ${folderKey}`);
    } catch (error) {
        console.error(`Lỗi khi tạo thư mục ${folderKey}:`, error);
    }
}


// Hàm xóa folder
async function deleteFolder(userName) {

    try {
        const deleteFolderParams = {
            Bucket: Buckets,
            Key: `${userName}/`
        };

        await s3Client.send(new DeleteObjectCommand(deleteFolderParams));

        console.log(`Folder "${userName}/" đã được xóa thành công.`);
    } catch (error) {
        console.error("Lỗi khi xóa folder:", error);
    } finally {
        await s3Client.destroy();
    }
}



// Hàm tạo Access Key và Secret Key cho người dùng IAM
async function createIAMUser(userName) {
    try {
        // Kiểm tra xem người dùng đã tồn tại hay chưa
        if (!await userExists(userName)) {
            // Tạo người dùng IAM
            const createUserCommand = new CreateUserCommand({
                UserName: userName
            });
            const createUserResponse = await iamClient.send(createUserCommand);

            if (createUserResponse) {
                // Gắn policy cho người dùng
                const attachPolicyCommand = new AttachUserPolicyCommand({
                    UserName: userName,
                    PolicyArn: IAMPolicy
                });
                await iamClient.send(attachPolicyCommand);

                // Tạo Access Key và Secret Key
                const createAccessKeyCommand = new CreateAccessKeyCommand({
                    UserName: userName
                });
                const createAccessKeyResponse = await iamClient.send(createAccessKeyCommand);

                const dataAccess = {
                    accessKey: createAccessKeyResponse.AccessKey.AccessKeyId,
                    accessSecret: createAccessKeyResponse.AccessKey.SecretAccessKey
                };

                const folderName = `${userName}/`;
                if (!(await folderExists(folderName))) {
                    await createFolder(folderName);
                } else {
                    console.log(`Thư mục ${folderName} đã tồn tại. Không thể tạo.`);
                }

                console.log(`Người dùng IAM "${userName}" đã được tạo, gắn policy và tạo Access Key thành công.`);
                console.log(`Access Key: ${JSON.stringify(dataAccess, null, 2)}`);
            }

        } else {
            console.log(`Người dùng IAM "${userName}" không tồn tại.Không thể tạo.`);
        }

        // Hiển thị danh sách các nhóm IAM sau khi tạo xong
        // await listIAMGroups();
    } catch (error) {
        console.error("Lỗi khi tạo người dùng IAM, gắn policy và tạo Access Key:", error);
    } finally {
        // Đảm bảo đóng kết nối
        await iamClient.destroy();
    }
}
async function deleteIAMUser(userName) {
    try {
        if (await userExists(userName)) {
            // Lấy danh sách các access key đính kèm với người dùng
            const listAccessKeysCommand = new ListAccessKeysCommand({
                UserName: userName
            });
            const listAccessKeysResponse = await iamClient.send(listAccessKeysCommand);

            // Duyệt qua từng access key và xóa chúng
            for (const accessKey of listAccessKeysResponse.AccessKeyMetadata) {
                const deleteAccessKeyCommand = new DeleteAccessKeyCommand({
                    UserName: userName,
                    AccessKeyId: accessKey.AccessKeyId
                });
                await iamClient.send(deleteAccessKeyCommand);
                console.log(`Access Key "${accessKey.AccessKeyId}" đã được xóa khỏi người dùng.`);
            }

            // Lấy danh sách các policy đính kèm với người dùng
            const listAttachedPoliciesCommand = new ListAttachedUserPoliciesCommand({
                UserName: userName
            });
            const listAttachedPoliciesResponse = await iamClient.send(listAttachedPoliciesCommand);

            // Duyệt qua từng policy và gỡ bỏ chúng
            for (const policy of listAttachedPoliciesResponse.AttachedPolicies) {
                const detachPolicyCommand = new DetachUserPolicyCommand({
                    UserName: userName,
                    PolicyArn: policy.PolicyArn
                });
                await iamClient.send(detachPolicyCommand);
                console.log(`Policy "${policy.PolicyName}" đã được gỡ bỏ khỏi người dùng.`);
            }

            // Tiến hành xóa người dùng
            const deleteUserCommand = new DeleteUserCommand({
                UserName: userName
            });
            await iamClient.send(deleteUserCommand);
            await deleteFolder(userName);


            console.log(`Người dùng IAM "${userName}" đã được xóa thành công.`);
            // await listIAMGroups();
        } else {
            console.log(`Người dùng IAM "${userName}" không tồn tại. Không thể xóa.`);
        }

    } catch (error) {
        console.error("Lỗi khi xóa người dùng IAM:", error);
    } finally {
        // Đảm bảo đóng kết nối
        await iamClient.destroy();
    }
}

const functionName = process.argv[2];
const paramsInput = process.argv[3];
if (functionName === 'createIAMUser') {
    createIAMUser(paramsInput);
} else if (functionName === 'deleteIAMUser') {
    deleteIAMUser(paramsInput);
} else if (functionName === 'listIAMGroups') {
    listIAMGroups()
} else {
    console.error('Invalid function name. Use "function1" or "function2".');
}