/**
 * Author: Yin Qisen <yinqisen@gmail.com>
 * Github: https://github.com/uappkit
 * Copyright(c) 2022
 */

const _ = require('lodash');
const nopt = require('nopt');
const updateNotifier = require('update-notifier');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const pkg = require('../package.json');
const sync = require('./sync');
const stripJsonComments = require('./stripJsonComments');

const knownOpts = {
  version: Boolean,
  help: Boolean
};

const shortHands = {
  v: '--version',
  h: '--help'
};

const appDir = process.cwd();
const localLinkManifest = path.join(appDir, 'manifest.json');
const sdkHomeDir = path.join(require('os').homedir(), '.uappsdk');
let manifest = '';

module.exports = function (inputArgs) {
  checkForUpdates();

  const args = nopt(knownOpts, shortHands, inputArgs);
  if (args.version) {
    console.log('uapp 当前版本: ' + pkg.version);
    return;
  }

  // command: uapp help
  const cmd = args.argv.remain[0] || 'help';
  if (!cmd || cmd === 'help' || args.help) {
    printHelp();
    return;
  }

  // command: uapp new
  if (cmd === 'new') {
    let projectName = args.argv.remain[1];
    if (projectName) {
      try {
        require('child_process').execSync('vue create -p dcloudio/uni-preset-vue ' + projectName, { stdio: 'inherit' });
      } catch (error) {
        console.log('请先安装 vue 环境:');
        console.log('npm i -g @vue/cli');
      }
      return;
    }
  }

  // command: uapp sdk init
  if (cmd === 'sdk' && args.argv.remain[1] === 'init') {
    sync(path.resolve(__dirname, '../uappsdk'), sdkHomeDir);
    console.log(chalk.green('--- uappsdk 已安装 ---'));
    return;
  }

  // check project
  let projectType = 'unknown';
  if (fs.existsSync(path.join(appDir, 'Main/AppDelegate.m'))) {
    projectType = 'ios';
  } else if (fs.existsSync(path.join(appDir, '/app/build.gradle'))) {
    projectType = 'android';
  }

  // command: uapp keygen
  if (cmd === 'keygen') {
    if (projectType === 'android') {
      console.log('注意: ');
      console.log('build.gradle 中密码默认为 123456, 如有修改为其他密码，请对应修改 build.gradle 中的配置');
    }
    console.log('需要输入两次6位密码, 例如输入密码: 123456\n');

    let keyFile = path.join(appDir, 'app/app.keystore');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });

    try {
      let keyCommand =
        'keytool -genkey -alias key0 -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=uapp" -keystore ' + keyFile;
      require('child_process').execSync(keyCommand, { stdio: 'inherit' });
      console.log('\n证书生成位置: ' + keyFile);
    } catch (error) {
      console.log('\n错误解决方法, 改名已存在的文件: ' + keyFile);
    }

    return;
  }

  // command: uapp info, uapp info jwt, uapp info key
  if (cmd === 'info' && (!args.argv.remain[1] || args.argv.remain[1] === 'jwt' || args.argv.remain[1] === 'key')) {
    if (!args.argv.remain[1] && projectType !== 'unknown' && fs.existsSync(localLinkManifest)) {
      require('child_process').execSync('uapp manifest info', { stdio: 'inherit' });
    }

    if ((projectType === 'ios' && !args.argv.remain[1]) || args.argv.remain[1] === 'jwt') {
      printJWTToken();
      return;
    }

    if (projectType === 'android') {
      let keyFile = path.join(appDir, 'app/app.keystore');
      if (!fs.existsSync(keyFile)) {
        console.log('找不到 keystore 签名文件: ' + keyFile);
        return;
      }

      let gradle = require('os').type() === 'Windows_NT' ? 'gradlew.bat' : './gradlew';
      if (!fs.existsSync(path.resolve(gradle))) {
        console.log('找不到 gradle 命令: ' + gradle);
        return;
      }

      printAndroidKeyInfo(gradle);
      return;
    }
  }

  // command: uapp prepare
  if (cmd === 'prepare') {
    checkManifest();
    manifest = getManifest();
    let srcDir = path.dirname(fs.realpathSync(localLinkManifest));
    let compiledDir;

    let prepareDir = manifest.uapp ? manifest.uapp['prepare.dir'] : '';
    if (prepareDir) {
      compiledDir = prepareDir.replace(/\$\{SRC\}/g, srcDir);
    } else {
      compiledDir = path.join(srcDir, 'unpackage/resources/', manifest.appid);
    }

    let embedAppsDir = path.join(
      appDir,
      projectType === 'ios' ? 'Main/Pandora/apps' : 'app/src/main/assets/apps',
      manifest.appid
    );

    // run command before prepare
    let prepareBefore = manifest.uapp ? manifest.uapp['prepare.before'] : '';
    if (prepareBefore) {
      prepareBefore = prepareBefore.replace(/\$\{SRC\}/g, srcDir);
      require('child_process').execSync(prepareBefore, { stdio: 'inherit' });
    }

    fs.existsSync(embedAppsDir) && fs.rmdirSync(embedAppsDir, { recursive: true });
    fs.mkdirSync(embedAppsDir, { recursive: true });
    sync(compiledDir, embedAppsDir);
    console.log(chalk.green('打包APP资源已就绪'));

    // run command after prepare
    let prepareAfter = manifest.uapp ? manifest.uapp['prepare.after'] : '';
    if (prepareAfter) {
      prepareAfter = prepareAfter.replace(/\$\{SRC\}/g, srcDir);
      require('child_process').execSync(prepareAfter, { stdio: 'inherit' });
    }
    return;
  }

  // commands:
  // uapp manifest sync ${webapp}/src/manifest.json
  // uapp manifest info
  if (cmd === 'manifest' && (args.argv.remain[1] === 'sync' || args.argv.remain[1] === 'info')) {
    let manifestFile = args.argv.remain[2] || 'manifest.json';

    // check symlink
    if (manifestFile === 'manifest.json') {
      manifestFile = fs.realpathSync(localLinkManifest);
    }

    if (!fs.existsSync(manifestFile)) {
      console.log('找不到: ' + manifestFile);
      console.log('如需测试，可以使用 manifest 模板: ');
      console.log('uapp manifest sync ' + path.join(sdkHomeDir, 'templates/manifest.json'));
      return;
    }

    try {
      let fstats = fs.lstatSync(localLinkManifest);
      if (fstats.isSymbolicLink()) {
        fs.unlinkSync(localLinkManifest);
      } else {
        let backupName = 'manifest-' + new Date().getTime() + '.json';
        console.log('注意：当前目录不要直接使用 manifest.json 文件, 已更名为: ' + backupName);
        fs.renameSync(localLinkManifest, localLinkManifest.replace('manifest.json', backupName));
        return;
      }
    } catch (error) {}

    fs.symlinkSync(manifestFile, localLinkManifest);
    console.log('当前使用 manifest: ' + manifestFile);

    manifest = getManifest();
    manifest = _.merge(require(sdkHomeDir + '/templates/manifest.json'), manifest);

    manifest.uapp.name = manifest.uapp[`${projectType}.name`] || manifest.uapp.name || manifest.name;
    manifest.uapp.package = manifest.uapp[`${projectType}.package`] || manifest.uapp.package;
    manifest.uapp.versionName = manifest.uapp[`${projectType}.versionName`] || manifest.versionName;
    manifest.uapp.versionCode = manifest.uapp[`${projectType}.versionCode`] || manifest.versionCode;
    manifest.uapp.appkey = manifest.uapp[`${projectType}.appkey`];
    manifest.uapp.icon = manifest.uapp[`${projectType}.icon`] || manifest.uapp.icon || manifest.icon;


    console.log();
    console.log('- appid       : ' + manifest.appid);
    console.log('- appName     : ' + manifest.uapp.name);
    console.log('- package     : ' + manifest.uapp.package);
    console.log('- versionName : ' + manifest.uapp.versionName);
    console.log('- versionCode : ' + manifest.uapp.versionCode);
    if (manifest.uapp.appkey) {
      console.log('- appKey      : ' + manifest.uapp.appkey);
    }
    console.log();

    if (args.argv.remain[1] === 'sync') {
      projectType === 'android' && processAndroid();
      projectType === 'ios' && processIOS();
    }

    return;
  }

  // command: uapp publish debug
  if (cmd === 'publish' && args.argv.remain[1] === 'debug') {
    checkManifest();

    if (projectType === 'ios') {
      // gererate uapp_debug.xcarchive
      require('child_process').execSync(
        'xcodebuild -project uapp.xcodeproj -destination "generic/platform=iOS" -scheme "HBuilder" -archivePath out/uapp_debug.xcarchive archive',
        { stdio: 'inherit' }
      );

      // generate ipa
      require('child_process').execSync(
        'xcodebuild -exportArchive -archivePath out/uapp_debug.xcarchive -exportPath out -exportOptionsPlist config/export.plist',
        { stdio: 'inherit' }
      );

      sync(
        path.join(appDir, 'out/HBuilder.ipa'),
        path.join(path.dirname(fs.realpathSync(localLinkManifest)), 'unpackage/debug/ios_debug.ipa')
      );
      return;
    }

    if (projectType === 'android') {
      let gradle = require('os').type() === 'Windows_NT' ? 'gradlew.bat' : './gradlew';
      require('child_process').execSync(gradle + ' assembleDebug', { stdio: 'inherit' });

      sync(
        path.join(appDir, 'app/build/outputs/apk/debug/app-debug.apk'),
        path.join(path.dirname(fs.realpathSync(localLinkManifest)), 'unpackage/debug/android_debug.apk')
      );
      
      //打开文件夹
      require('child_process').exec('open app/build/outputs/apk/debug');
      return;
    }

    console.log('无法识别的工程模板，请参考帮助');
    return;
  }

  printHelp();
};

function checkForUpdates() {
  try {
    // Checks for available update and returns an instance
    const notifier = updateNotifier({ pkg: pkg });

    if (notifier.update && notifier.update.latest !== pkg.version) {
      // Notify using the built-in convenience method
      notifier.notify();
    }
  } catch (e) {
    // https://issues.apache.org/jira/browse/CB-10062
    if (e && e.message && /EACCES/.test(e.message)) {
      console.log('Update notifier was not able to access the config file.');
    } else {
      throw e;
    }
  }
}

function getFiles(dir, files_) {
  files_ = files_ || [];
  var files = fs.readdirSync(dir);
  for (var i in files) {
    var name = path.join(dir, files[i]);
    if (fs.statSync(name).isDirectory()) {
      getFiles(name, files_);
    } else {
      files_.push(name);
    }
  }
  return files_;
}

function cleanEmptyFoldersRecursively(folder) {
  var fs = require('fs');
  var path = require('path');

  var isDir = fs.statSync(folder).isDirectory();
  if (!isDir) {
    return;
  }
  var files = fs.readdirSync(folder);
  if (files.length > 0) {
    files.forEach(function (file) {
      var fullPath = path.join(folder, file);
      cleanEmptyFoldersRecursively(fullPath);
    });

    // re-evaluate files; after deleting subfolder
    // we may have parent folder empty now
    files = fs.readdirSync(folder);
  }

  if (files.length === 0) {
    fs.rmdirSync(folder);
    return;
  }
}

function checkManifest() {
  if (!fs.existsSync(localLinkManifest)) {
    console.log('请先执行 `uapp manifest sync` 指定 manifest.json 文件');
    process.exit(-1);
  }
}

function getManifest() {
  if (fs.existsSync(localLinkManifest)) {
    let content = fs.readFileSync(localLinkManifest, 'utf8');
    manifest = JSON.parse(stripJsonComments(content));
  }
  return manifest;
}

/*
 * android platform
 */

function processAndroid() {
  let wxEntryActivityFile = 'WXEntryActivity.java';
  let wXPayEntryActivityFile = 'WXPayEntryActivity.java';

  let baseGradleFile = path.join(appDir, 'app/build.gradle');
  let content = fs.readFileSync(baseGradleFile, 'utf-8');

  content = content.replace(/(applicationId\s+")(.*)(")/, '$1' + manifest.uapp.package + '$3');
  content = content.replace(/(app_name[',\s]+")(.*)(")/, '$1' + manifest.uapp.name + '$3');
  content = content.replace(/(versionCode\s+)(.*)/, '$1' + manifest.uapp.versionCode);
  content = content.replace(/(versionName\s+")(.*)(")/, '$1' + manifest.uapp.versionName + '$3');
  fs.writeFileSync(baseGradleFile, content);

  //修改DCLOUD_APPKEY ---------- START
  let customGradleFile = path.join(appDir, 'app/custom.gradle');
  let customContent = fs.readFileSync(customGradleFile, 'utf-8');
  customContent = customContent.replace(/("DCLOUD_APPKEY"\s+:\s+")(.*)(",)/, '$1' + manifest.uapp.appkey + '$3');
  customContent = customContent.replace(
    /("WX_APPID"\s+:\s+")(.*)(",)/,
    '$1' + manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appid + '$3'
  );
  customContent = customContent.replace(
    /("WX_SECRET"\s+:\s+")(.*)(",)/,
    '$1' + manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appsecret + '$3'
  );
  fs.writeFileSync(customGradleFile, customContent);

  let xmlFile = path.join(appDir, 'app/src/main/AndroidManifest.xml');
  let xmlContent = fs.readFileSync(xmlFile, 'utf-8');
  xmlContent = xmlContent.replace(/(\${DCLOUD_APPKEY})/, manifest.uapp.appkey);
  fs.writeFileSync(xmlFile, xmlContent);
  //修改DCLOUD_APPKEY ---------- END  

  //修改ICON ---------- START
  let iconFile = path.join(appDir, 'app/src/main/res/drawable-xxhdpi/icon.png');
  fs.copyFileSync(manifest.uapp.icon, iconFile)
  //修改ICON ---------- END


  let sourceDir = path.join(appDir, 'app/src/main/java/');
  for (const entryFile of [wxEntryActivityFile, wXPayEntryActivityFile]) {
    getFiles(sourceDir).forEach((file) => {
      file.endsWith(entryFile) && fs.unlinkSync(file);
    });
  }

  // cleanup empty folder
  cleanEmptyFoldersRecursively(sourceDir);

  // DONT change content here
  let contentOfEntryFiles = {
    [wxEntryActivityFile]: `package ${manifest.uapp.package}.wxapi;
import io.dcloud.feature.oauth.weixin.AbsWXCallbackActivity;
public class WXEntryActivity extends AbsWXCallbackActivity {
}
`,
    [wXPayEntryActivityFile]: `package ${manifest.uapp.package}.wxapi;
import io.dcloud.feature.payment.weixin.AbsWXPayCallbackActivity;
public class WXPayEntryActivity extends AbsWXPayCallbackActivity{
}
`
  };

  for (const entryFile of [wxEntryActivityFile, wXPayEntryActivityFile]) {
    let replaceFile = path.join(
      appDir,
      'app/src/main/java/',
      manifest.uapp.package.replace(/\./g, '/'),
      'wxapi',
      entryFile
    );

    fs.mkdirSync(path.dirname(replaceFile), { recursive: true });
    fs.writeFileSync(replaceFile, contentOfEntryFiles[entryFile]);
  }

  replaceControlXml(path.join(appDir, 'app/src/debug/assets/data/dcloud_control.xml'));
  replaceControlXml(path.join(appDir, 'app/src/main/assets/data/dcloud_control.xml'));

  let sdkLinkDir = path.join(appDir, 'app/libs');
  try {
    fs.unlinkSync(sdkLinkDir);
  } catch (e) {}
  fs.symlinkSync(path.join(sdkHomeDir, 'android/libs'), sdkLinkDir, 'dir');

  console.log('processAndroid successfully');
}

/*
 * ios platform
 */

function processIOS() {
  let baseYamlFile = path.join(appDir, 'config/base.yml');
  let content = fs.readFileSync(baseYamlFile, 'utf-8');

  content = content.replace(/(PRODUCT_BUNDLE_IDENTIFIER: )(.*)/, '$1' + manifest.uapp.package);
  content = content.replace(/(MARKETING_VERSION: )(.*)/g, '$1' + manifest.uapp.versionName);
  content = content.replace(/(CURRENT_PROJECT_VERSION: )(.*)/g, '$1' + manifest.uapp.versionCode);
  fs.writeFileSync(baseYamlFile, content);

  replaceStoryboard(path.join(appDir, 'Main/Resources/LaunchScreen.storyboard'));
  replaceStoryboard(path.join(appDir, 'Main/Resources/LaunchScreenAD.storyboard'));

  replaceInfoPlist(path.join(appDir, 'Main/Resources/AppDev/Info.plist'));
  replaceInfoPlist(path.join(appDir, 'Main/Resources/AppRelease/Info.plist'));

  replaceControlXml(path.join(appDir, 'Main/Resources/AppDev/control.xml'));
  replaceControlXml(path.join(appDir, 'Main/Resources/AppRelease/control.xml'));

  let sdkLinkDir = path.join(appDir, '/SDKs/SDK');
  if (!fs.existsSync(sdkLinkDir)) {
    let iosSDKDir = path.join(sdkHomeDir, '/ios/SDK');
    if (!fs.existsSync(iosSDKDir)) {
      console.log('找不到iOS SDK，请参照 README 配置');
      console.log('SDK 位置: ' + iosSDKDir);
    } else {
      fs.symlinkSync(path.join(sdkHomeDir, '/ios/SDK'), sdkLinkDir, 'dir');
    }
  }

  // require('child_process').execSync('xcodegen', { stdio: 'inherit' });
  console.log('processIOS successfully');
}

function replaceStoryboard(storyboardFile) {
  let content = fs.readFileSync(storyboardFile, 'utf-8');
  var re = /(text=")(.+?)(".+)(?=uapp-launchscreen-appname)/;
  content = content.replace(re, '$1' + manifest.uapp.name + '$3');
  fs.writeFileSync(storyboardFile, content);
}

function replaceInfoPlist(plistFile) {
  let content = fs.readFileSync(plistFile, 'utf-8');
  let re = /(<key>dcloud_appkey<\/key>\n.+?<string>)(.*?)(<\/string>)/g;
  content = content.replace(re, '$1' + manifest.uapp.appkey + '$3');

  // replace ios and wexin meanwhile
  re = /(<key>UniversalLinks<\/key>\n.+?<string>)(.*?)(<\/string>)/g;
  content = content.replace(re, '$1' + manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.UniversalLinks + '$3');

  re = /(<key>weixin<\/key>[\s\S]+?appid<\/key>\n.+?<string>)(.*?)(<\/string>)/g;
  content = content.replace(re, '$1' + manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appid + '$3');

  re = /(<string>weixin<\/string>\n.+?<key>CFBundleURLSchemes<\/key>[\s\S]+?<string>)(.*?)(<\/string>)/g;
  content = content.replace(re, '$1' + manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appid + '$3');

  re = /(<key>weixin<\/key>[\s\S]+?appSecret<\/key>\n.+<string>)(.*?)(<\/string>)/g;
  content = content.replace(re, '$1' + manifest['app-plus'].distribute.sdkConfigs.oauth.weixin.appsecret + '$3');

  re = /(<key>CFBundleDisplayName<\/key>\n.+?<string>)(.*?)(<\/string>)/g;
  if (!re.test(content)) {
    console.error('no CFBundleDisplayName, you should use xcode set Display Name first');
    process.exit(1);
  }

  content = content.replace(re, '$1' + manifest.uapp.name + '$3');
  fs.writeFileSync(plistFile, content);
}

function replaceControlXml(xmlFile) {
  let content = fs.readFileSync(xmlFile, 'utf-8');
  let re = /(app appid=")(.+?)(")/g;
  content = content.replace(re, '$1' + manifest.appid + '$3');
  fs.writeFileSync(xmlFile, content);
}

// generate jwt token for apple oauth login
function printJWTToken() {
  console.log('------ JWT Token ------');
  try {
    let config = require(path.join(appDir, 'jwt/config.json'));

    if (!config.team_id) {
      let content = fs.readFileSync(path.join(appDir, 'config/custom.yml'), 'utf-8');
      let r = content.match(/DEVELOPMENT_TEAM:\s+(.*)/);
      config.team_id = r[1] || '';
    }

    if (!config.team_id) {
      throw '请在 jwt/config.json 中设置 team_id';
    }

    let privateKey = fs.readFileSync(path.join(appDir, 'jwt/key.txt'));
    let headers = { kid: config.key_id };
    let timestamp = Math.floor(Date.now() / 1000);
    let claims = {
      iss: config.team_id,
      iat: timestamp,
      exp: timestamp + 86400 * 180,
      aud: 'https://appleid.apple.com',
      sub: config.client_id
    };

    const jwt = require('jsonwebtoken');
    let token = jwt.sign(claims, privateKey, { algorithm: 'ES256', header: headers });
    console.log(token);
  } catch (error) {
    console.log(error.message + '\n');
    console.log('jwt/config.json 内容参考: ');
    console.log(`
{
    "team_id": "3DSM494K6L",
    "client_id": "com.code0xff.uapp.login",
    "key_id": "3C7FMSZC8Z"
}
    `);

    console.log('👉 参考教程: http://help.jwt.code0xff.com');
  }
}

function printAndroidKeyInfo(gradle) {
  manifest = getManifest();

  let output = require('child_process')
    .execSync(gradle + ' app:signingReport')
    .toString();
  let r = output.match(/Variant: release[\s\S]+?----------/);

  let md5 = r[0].match(/MD5: (.+)/)[1].replace(/:/g, '');
  let sha1 = r[0].match(/SHA1: (.+)/)[1];
  console.log('👇 应用签名 (MD5), 用于微信开放平台:');
  console.log(md5);
  console.log();
  console.log('👇 Android 证书签名 (SHA1), 用于离线打包 Key:');
  console.log(sha1);

  // for uniapp project
  if (manifest) {
    console.log('https://dev.dcloud.net.cn/app/build-config?appid=' + manifest.appid);
  }

  console.log();
  console.log('----------');
  console.log(r[0]);
}

function printHelp() {
  console.log(fs.readFileSync(path.join(__dirname, '../doc/help.txt'), 'utf-8'));
}
