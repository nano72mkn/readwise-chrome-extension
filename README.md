# readwise-chrome-extension
Manual upload of Readwise's chrome extension installed on my machine

amazon.co.jpからハイライトを取得できるようにしました。

!!! 注意 !!!
この拡張は、`非公式`です
メンテナンスをするかもわからないので、使えなくなることも頭に入れておいてください。
僕がReadwiseを手放すまではゆるーくメンテするつもりです。

1. コードを持ってくる

githubの使い方をわかる方は、cloneしてください
```dotnetcli
git clone git@github.com:shota1995m/readwise-chrome-extension.git
```

わからない方は`<> Code`と書かれているボタンから`Download Zip`してコードを持ってきてください
そのあと、Zipを解凍

2. デベロッパーモードをONにする
- [拡張機能のページ](chrome://extensions/)を開く
- 右上にあるデベロッパーモードをONにする

3. パッケージを読み込む
- 画面左上にある`パッケージ化されていない拡張機能を読み込む`をクリック
- 持ってきたコードのフォルダごと選択
  - おそらく、フォルダ名は`readwise-chrome-extension`になってるはず
- 拡張機能一覧に`Readwise_for_amazon.co.jp`が追加されていればOK

4. Kindleのハイライトページへ移動
勝手に同期が始まります
https://read.amazon.co.jp/kp/notebook?ft

5. 公式サポートされたら...
もし、公式で`amazon.co.jp`がサポートされたらこの拡張は消して、公式のものを使ってください。
