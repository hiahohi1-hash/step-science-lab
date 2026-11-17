이 폴더의 파일은 직접 고치지 마세요.

tf-1.3.1.min.js
  - @tensorflow/tfjs 1.3.1 의 브라우저용 파일 (Copyright Google, Apache License 2.0)
teachablemachine-image-0.8.5.min.js
  - @teachablemachine/image 0.8.5 의 브라우저용 파일 (Copyright Google, Apache License 2.0)

왜 npm 으로 설치하지 않고 파일로 넣었나요?
  - 티처블 머신 라이브러리는 텐서플로 1.3.1 버전만 지원합니다.
  - 이 버전을 npm 으로 설치하면 오래된 node-fetch 패키지가 서버에 같이 설치되는데,
    여기에 보안 취약점이 있습니다. 브라우저에서만 쓰는 파일이므로 파일만 넣어 두었습니다.
