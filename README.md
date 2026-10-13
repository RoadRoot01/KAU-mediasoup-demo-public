# KAU mediasoup demo

이 프로젝트는 제어된 LAN 환경에서 WebRTC 부하 테스트, 텔레메트리 수집, SFU 호스트 모니터링 및 다중 피어 성능 분석을 수행하기 위해 [versatica/mediasoup-demo](https://github.com/versatica/mediasoup-demo)를 수정한 프로젝트입니다. 원본 프로젝트의 문서와 저작자 표기를 유지하면서 다음 기능을 추가했습니다.

- 브라우저 WebRTC 클라이언트 통계 수집 및 JSON 내보내기
- SFU 및 호스트 지표 수집 및 CSV 저장(CPU, 메모리, Chrome, GPU, 온도, 배터리 등)
- 내보낸 통계와 시스템 지표를 분석하기 위한 WebRTC 텔레메트리 및 SFU 시스템 대시보드
- LAN 주소 자동 감지 및 `listenIp` / `announcedAddress` 개별 설정
- mkcert를 이용한 로컬 TLS 인증서 자동 생성 및 LAN/사설 네트워크 origin 처리
- LAN 테스트용 설정, 선택적 네트워크 제한 기능 및 앱용 `npm run start:prod`
- Simulcast 실험을 위한 Consumer preferred layer 기본값 및 제어 기능

원본 mediasoup-demo의 `setConsumerPreferredLayers` 동작은 그대로 유지하며, 실험에 사용하는 기본 레이어 설정과 관련 제어 기능만 KAU 프로젝트에서 추가했습니다.

## 보안 및 사용 범위

이 프로젝트는 제어된 LAN 환경에서의 테스트와 실험을 목적으로 합니다. 인터넷에 직접 노출되는 실제 화상회의 서비스를 대상으로 보안이 강화된 프로젝트는 아닙니다.

Signaling 구조는 mediasoup-demo의 peer 식별 및 재접속 방식을 따르며, 동일한 `peerId`로 새 연결이 들어오면 기존 연결이 대체될 수 있습니다. 또한 애플리케이션 수준의 사용자 인증 기능은 제공하지 않습니다.

공개 인터넷 환경에서 사용하려면 별도의 인증·인가, rate limiting, reverse proxy, 네트워크 접근 제어 및 추가 보안 검토가 필요합니다. `.env`, TLS 인증서, 인증 정보 및 실험 결과 파일은 저장소에 커밋하지 마십시오.

## 요구 사항

- Node.js 22 이상 및 npm
- mediasoup 빌드에 필요한 Python 3 및 C++ 빌드 도구
  - Windows: Visual Studio C++ Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential`
- 로컬에서 신뢰할 수 있는 개발용 인증서를 생성하기 위한 [mkcert](https://github.com/FiloSottile/mkcert)

mkcert의 로컬 개발용 CA는 처음 한 번 설치합니다.

```sh
mkcert -install
```

서버를 처음 실행하면 `server/certs/cert.pem`, `server/certs/key.pem`, `server/certs/.ip` 파일을 생성합니다. 이 파일들은 로컬 전용이며 Git에서 제외됩니다.

이미 사용할 TLS 인증서가 있다면 환경 변수 또는 로컬 `server/.env`에 `TLS_CERT`와 `TLS_KEY`를 모두 설정합니다. 상대 경로는 `server/`를 기준으로 해석되며, 두 변수는 반드시 함께 지정해야 합니다.

## 처음부터 실행하기

### 1. 서버 설정

필요한 경우 예제 환경 설정 파일을 복사한 뒤 로컬 환경에 맞게 수정합니다.

```sh
cd server
cp .env.example .env
npm ci
npm start
```

PowerShell에서는 필요한 경우 `cp` 대신 다음 명령을 사용할 수 있습니다.

```powershell
Copy-Item .env.example .env
```

기본 설정에서는 실행 중인 시스템의 로컬 IPv4 주소를 자동으로 감지합니다. 외부 TLS 인증서가 설정되어 있지 않고 로컬 인증서도 생성할 수 없는 경우, 필요한 설치 안내를 출력한 뒤 서버 실행을 중단합니다.

### 2. 앱 빌드 및 실행

두 번째 터미널에서 저장소 루트를 기준으로 다음 명령을 실행합니다.

```sh
cd app
npm ci --legacy-peer-deps
npm run start:prod
```

프로덕션 빌드는 HTTPS `5555` 포트에서 제공됩니다. Hot reload가 필요한 Vite 개발 모드를 사용할 경우 `app/`에서 `npm start`를 실행합니다.

## LAN 접속 및 사용 포트

같은 LAN에 연결된 다른 장치에서 `https://<YOUR_LOCAL_IP>:5555/`로 접속합니다. `mkcert -install`로 설치한 개발용 CA는 설치된 시스템에서 생성 인증서를 신뢰하도록 구성하지만, 각 클라이언트 장치에서도 별도의 신뢰 설정이 필요할 수 있습니다.

필요에 따라 로컬 방화벽에서 다음 포트를 허용합니다.

- TCP `5555`: Vite 앱 / production preview
- TCP `4443`: HTTPS API 및 signaling
- UDP 및 TCP `44444`: WebRTC media transport
- UDP 및 TCP `40000-40999`: broadcaster에서 사용하는 선택적 plain RTP/RTCP transport

앱의 기본 방 이름은 `test`입니다. 자주 사용하는 옵션은 `?roomId=my-room`, `?forceVP8=true`, `?forceH264=true`, `?info=true` 등이 있습니다.

`?consumerReplicas=N`은 방이 처음 생성될 때 방 전체의 중복 Consumer 수를 설정합니다. 서버는 `0`부터 `10`까지의 정수를 허용하므로, 각 수신 참여자는 Producer 하나당 최대 11개의 Consumer를 생성할 수 있습니다. 제어된 부하 시뮬레이션에 사용할 수 있습니다.

로컬 네트워크 제한 기능을 제어하려면 설정한 secret을 `#throttleSecret=<value>`와 같은 URL fragment로 전달합니다. 앱은 방 정보를 불러오기 전에 이 값을 읽은 뒤 URL에서 제거하며, 초대 링크에도 포함하지 않습니다. 서버 로그에 query string이 기록될 수 있으므로 secret을 query parameter로 전달하지 마십시오.

### 로컬 HTTPS 환경에서 broadcaster 실행

Broadcaster 예제는 `https://localhost:4443`에 연결하며 서버와 같은 시스템에서 실행하는 것을 기본으로 합니다. Node.js가 로컬 mkcert CA를 신뢰해야 하므로, broadcaster를 실행하기 전에 `NODE_EXTRA_CA_CERTS`가 mkcert의 `rootCA.pem`을 가리키도록 설정합니다.

```sh
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

PowerShell에서는 다음과 같이 설정합니다.

```powershell
$env:NODE_EXTRA_CA_CERTS = Join-Path (mkcert -CAROOT) 'rootCA.pem'
```

이 설정은 Node.js broadcaster 프로세스를 시작하기 전에 적용해야 합니다. Broadcaster는 서버 인증서와 hostname을 검증하므로 TLS 검증을 비활성화하지 마십시오.

다른 LAN 장치에서 broadcaster를 실행하려면 `broadcaster/src/index.ts`의 `baseUrl`을 서버의 LAN IP 또는 로컬 hostname으로 설정합니다. URL에 사용하는 이름은 서버 인증서에 포함되어 있어야 하며 서버의 `DOMAIN` 설정과 일치해야 합니다.

사용자 지정 hostname을 사용할 경우 `server/.env`에 `DOMAIN=<YOUR_HOSTNAME>`을 설정한 뒤, 각 클라이언트 장치에서 DNS 또는 hosts 파일을 이용해 해당 hostname을 서버 LAN IP에 연결합니다. 이후 `https://<YOUR_HOSTNAME>:5555/`로 앱에 접속합니다.

`DOMAIN`을 변경한 뒤 서버를 다시 시작하면 새 이름을 반영한 로컬 인증서가 다시 생성됩니다. 이 인증서 역시 Git에서 제외됩니다. Broadcaster URL에도 동일한 hostname을 사용합니다.

## 설정

`server/config.mjs`에는 데모 기본 설정이 있으며 로컬 IPv4 주소를 자동으로 감지합니다. 환경 기반 설정을 변경하려면 `server/.env.example`을 `server/.env`로 복사해 수정합니다.

선택적 `NETWORK_THROTTLE_SECRET`은 기본적으로 설정되어 있지 않습니다. 운영자가 로컬에서 충분히 강한 무작위 secret을 지정하기 전까지 네트워크 제한 제어 기능은 사용할 수 없습니다. 실제 설정값은 저장소에 커밋하지 마십시오.

## 텔레메트리 대시보드

대시보드 소스는 `tools/` 아래에 있습니다. 실행 중 생성되는 로그와 측정 데이터는 Git에서 제외된 `server/logs/`에 저장되며 저장소에는 포함되지 않습니다.

### WebRTC 텔레메트리 확인 절차

1. 데모를 실행한 뒤 방에 접속합니다.
2. 방에서 **WebRTC Stats Download**를 선택해 수집된 JSON 이력을 저장합니다.
3. 브라우저에서 `tools/webrtc-stats-dashboard/index.html`을 엽니다.
4. 내려받은 JSON 파일을 불러옵니다. 대시보드는 outbound/inbound RTP, SSRC stream, local/remote/SFU probator 역할, codec 및 simulcast layer, bitrate, FPS, jitter, packet loss, 해상도와 시간 흐름을 분석합니다. 내장 preview에서는 생성된 synthetic data를 사용합니다.

### SFU 시스템 텔레메트리 확인 절차

1. 서버를 실행합니다. `KAU_CUSTOM_MetricsCollector`가 주기적으로 호스트와 SFU 측정값을 `server/logs/` 아래의 CSV 파일에 기록합니다.
2. 브라우저에서 `tools/sfu-system-dashboard/index.html`을 엽니다.
3. 생성된 CSV 파일을 불러옵니다. 대시보드는 SFU, 시스템 및 Chrome의 CPU/메모리 사용량과 GPU, 온도, 배터리 지표를 분석합니다. 내장 preview에서는 생성된 synthetic data를 사용합니다.

## 원본 프로젝트 및 라이선스

이 저장소는 [versatica/mediasoup-demo](https://github.com/versatica/mediasoup-demo)를 기반으로 합니다. 원본 프로젝트의 저자는 다음과 같습니다.

- Iñaki Baz Castillo ([website](https://inakibaz.me), [GitHub](https://github.com/ibc/))
- José Luis Millán Villegas ([GitHub](https://github.com/jmillan/))

루트 프로젝트의 라이선스는 [ISC](./LICENSE)이며 원본 프로젝트의 저작권 및 저작자 표기를 유지합니다. 비교 기준으로 사용한 upstream 버전의 `app/package.json`과 `broadcaster/package.json`에는 이미 `"license": "All Rights Reserved"`가 지정되어 있으며, 이 package metadata 값은 원본 프로젝트에서 그대로 이어받은 것입니다.
